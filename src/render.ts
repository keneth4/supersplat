import { ZipFileSystem } from '@playcanvas/splat-transform';
import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, MkvOutputFormat, MovOutputFormat, Mp4OutputFormat, Output, StreamTarget, WebMOutputFormat } from 'mediabunny';
import { Color, path, Vec3 } from 'playcanvas';

import { ElementType } from './element';
import { Events } from './events';
import { BrowserFileSystem } from './io';
import { PngCompressor } from './png-compressor';
import { Scene } from './scene';
import { Splat } from './splat';
import { localize } from './ui/localization';

const nullClr = new Color(0, 0, 0, 0);

// Lookup maps for video output format and codec configuration
const FORMAT_CONFIG: Record<string, { create: (streaming: boolean) => Mp4OutputFormat | MovOutputFormat | MkvOutputFormat | WebMOutputFormat; extension: string }> = {
    mp4: { create: streaming => new Mp4OutputFormat({ fastStart: streaming ? false : 'in-memory' }), extension: 'mp4' },
    webm: { create: () => new WebMOutputFormat(), extension: 'webm' },
    mov: { create: streaming => new MovOutputFormat({ fastStart: streaming ? false : 'in-memory' }), extension: 'mov' },
    mkv: { create: () => new MkvOutputFormat(), extension: 'mkv' }
};

const CODEC_CONFIG: Record<string, { type: 'avc' | 'hevc' | 'vp9' | 'av1'; codec: (height: number) => string }> = {
    h264: { type: 'avc', codec: h => (h < 1080 ? 'avc1.420028' : 'avc1.640033') }, // H.264 Constrained Baseline/High profile
    h265: { type: 'hevc', codec: () => 'hev1.1.6.L120.B0' },                       // H.265 Main profile, Level 4.0
    vp9: { type: 'vp9', codec: () => 'vp09.00.10.08' },                            // VP9 Profile 0, Level 1.0
    av1: { type: 'av1', codec: () => 'av01.0.05M.08' }                             // AV1 Main Profile, Level 3.1
};

type ImageSettings = {
    width: number;
    height: number;
    transparentBg: boolean;
    showDebug: boolean;
};

type VideoSettings = {
    startFrame: number;
    endFrame: number;
    frameRate: number;
    width: number;
    height: number;
    bitrate: number;
    transparentBg: boolean;
    showDebug: boolean;
    format: 'mp4' | 'webm' | 'mov' | 'mkv';
    codec: 'h264' | 'h265' | 'vp9' | 'av1';
};

type SequenceSettings = {
    startFrame: number;
    endFrame: number;
    width: number;
    height: number;
    transparentBg: boolean;
    showDebug: boolean;
    zipBasename: string;
};

const removeExtension = (filename: string) => {
    return filename.substring(0, filename.length - path.getExtension(filename).length);
};

const downloadFile = (arrayBuffer: ArrayBuffer, filename: string) => {
    const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.download = filename;
    el.href = url;
    el.click();
    window.URL.revokeObjectURL(url);
};

const registerRenderEvents = (scene: Scene, events: Events) => {
    let compressor: PngCompressor;

    const ensureCompressor = () => {
        if (!compressor) {
            compressor = new PngCompressor();
        }
        return compressor;
    };

    // wait for postrender to fire
    const postRender = () => {
        return new Promise<boolean>((resolve, reject) => {
            const handle = scene.events.on('postrender', () => {
                handle.off();
                try {
                    resolve(true);
                } catch (error) {
                    reject(error);
                }
            });
        });
    };

    const sortAndWait = (splats: Splat[]) => {
        return Promise.all(splats.map((splat) => {
            return new Promise<void>((resolve) => {
                const { instance } = splat.entity.gsplat;
                instance.sorter.once('updated', resolve);
                instance.sort(scene.camera.mainCamera);
                setTimeout(resolve, 1000);
            });
        }));
    };

    const createFramePreparationState = () => ({
        lastPos: new Vec3(0, 0, 0),
        lastForward: new Vec3(1, 0, 0)
    });

    const prepareFrame = async (frameTime: number, state: { lastPos: Vec3, lastForward: Vec3 }): Promise<Splat | null> => {
        // Fire timeline.time for camera animation interpolation
        events.fire('timeline.time', frameTime);

        // Wait for PLY sequence to load the frame if present
        const newSplat = await events.invoke('plysequence.setFrameAsync', Math.floor(frameTime)) as Splat | null;

        // manually update the camera so position and rotation are correct
        scene.camera.onUpdate(0);

        if (newSplat) {
            await sortAndWait([newSplat]);
        } else {
            const pos = scene.camera.position;
            const forward = scene.camera.forward;
            if (!state.lastPos.equals(pos) || !state.lastForward.equals(forward)) {
                state.lastPos.copy(pos);
                state.lastForward.copy(forward);

                const splats = (scene.getElementsByType(ElementType.splat) as Splat[]).filter(splat => splat.visible);
                await sortAndWait(splats);
            }
        }

        return newSplat;
    };

    const readFrameData = async (width: number, height: number, data: Uint8Array, line: Uint8Array, flipY: boolean) => {
        const { mainTarget, workTarget } = scene.camera;

        scene.dataProcessor.copyRt(mainTarget, workTarget);

        await workTarget.colorBuffer.read(0, 0, width, height, { renderTarget: workTarget, data });

        if (flipY) {
            for (let y = 0; y < height / 2; y++) {
                const top = y * width * 4;
                const bottom = (height - y - 1) * width * 4;
                line.set(data.subarray(top, top + width * 4));
                data.copyWithin(top, bottom, bottom + width * 4);
                data.set(line, bottom);
            }
        }
    };

    const configureOffscreenRender = (width: number, height: number, transparentBg: boolean, showDebug: boolean) => {
        scene.camera.startOffscreenMode(width, height);
        scene.camera.renderOverlays = showDebug;
        scene.gizmoLayer.enabled = false;
        if (!transparentBg) {
            scene.camera.clearPass.setClearColor(events.invoke('bgClr'));
        }
        scene.lockedRenderMode = true;
    };

    const resetOffscreenRender = () => {
        scene.camera.endOffscreenMode();
        scene.camera.renderOverlays = true;
        scene.gizmoLayer.enabled = true;
        scene.camera.clearPass.setClearColor(nullClr);
        scene.lockedRenderMode = false;
        scene.forceRender = true;
    };

    events.function('render.offscreen', async (width: number, height: number): Promise<Uint8Array> => {
        try {
            // start rendering to offscreen buffer only
            scene.camera.startOffscreenMode(width, height);
            scene.camera.renderOverlays = false;
            scene.gizmoLayer.enabled = false;

            // render the next frame
            scene.forceRender = true;

            // for render to finish
            await postRender();

            // cpu-side buffer to read pixels into
            const data = new Uint8Array(width * height * 4);

            const { mainTarget, workTarget } = scene.camera;

            scene.dataProcessor.copyRt(mainTarget, workTarget);

            // read the rendered frame
            await workTarget.colorBuffer.read(0, 0, width, height, { renderTarget: workTarget, data });

            // flip y positions to have 0,0 at the top
            let line = new Uint8Array(width * 4);
            for (let y = 0; y < height / 2; y++) {
                line = data.slice(y * width * 4, (y + 1) * width * 4);
                data.copyWithin(y * width * 4, (height - y - 1) * width * 4, (height - y) * width * 4);
                data.set(line, (height - y - 1) * width * 4);
            }

            return data;
        } finally {
            scene.camera.endOffscreenMode();
            scene.camera.renderOverlays = true;
            scene.gizmoLayer.enabled = true;
            scene.camera.camera.clearColor.set(0, 0, 0, 0);
        }
    });

    events.function('render.image', async (imageSettings: ImageSettings) => {
        events.fire('startSpinner');

        try {
            const { width, height, transparentBg, showDebug } = imageSettings;
            const bgClr = events.invoke('bgClr');

            // start rendering to offscreen buffer only
            scene.camera.startOffscreenMode(width, height);
            scene.camera.renderOverlays = showDebug;
            scene.gizmoLayer.enabled = false;
            if (!transparentBg) {
                scene.camera.clearPass.setClearColor(events.invoke('bgClr'));
            }

            // render the next frame
            scene.forceRender = true;

            // for render to finish
            await postRender();

            // cpu-side buffer to read pixels into
            const data = new Uint8Array(width * height * 4);

            const { mainTarget, workTarget } = scene.camera;

            scene.dataProcessor.copyRt(mainTarget, workTarget);

            // read the rendered frame
            await workTarget.colorBuffer.read(0, 0, width, height, { renderTarget: workTarget, data });

            const arrayBuffer = await ensureCompressor().compress(
                new Uint32Array(data.buffer),
                width,
                height
            );

            // construct filename
            const selected = events.invoke('selection') as Splat;
            const filename = `${removeExtension(selected?.name ?? 'SuperSplat')}-image.png`;

            // download
            downloadFile(arrayBuffer, filename);

            return true;
        } catch (error) {
            await events.invoke('showPopup', {
                type: 'error',
                header: localize('panel.render.failed'),
                message: `'${error.message ?? error}'`
            });
        } finally {
            scene.camera.endOffscreenMode();
            scene.camera.renderOverlays = true;
            scene.gizmoLayer.enabled = true;
            scene.camera.clearPass.setClearColor(nullClr);

            events.fire('stopSpinner');
        }
    });

    events.function('render.sequenceZip', async (sequenceSettings: SequenceSettings, fileStream?: FileSystemWritableFileStream) => {
        const { startFrame, endFrame, width, height, transparentBg, showDebug, zipBasename } = sequenceSettings;
        const totalFrames = endFrame - startFrame + 1;
        const filename = `${zipBasename}.zip`;
        const frameRate = events.invoke('timeline.frameRate') as number;
        let completed = false;

        if (totalFrames < 1) {
            return false;
        }

        events.fire('progressStart', localize('panel.render.render-sequence'), true);

        let cancelled = false;
        const cancelHandler = events.on('progressCancel', () => {
            cancelled = true;
        });

        try {
            configureOffscreenRender(width, height, transparentBg, showDebug);

            const browserFs = new BrowserFileSystem(filename, fileStream);
            const zipWriter = browserFs.createWriter(filename);
            const zipFs = new ZipFileSystem(zipWriter);
            const preparationState = createFramePreparationState();
            const digits = 4;

            const writeEntry = async (entryName: string, data: Uint8Array) => {
                const writer = await zipFs.createWriter(entryName);
                await writer.write(data);
                await writer.close();
            };

            for (let frame = startFrame; frame <= endFrame; frame++) {
                if (cancelled) {
                    return false;
                }

                await prepareFrame(frame, preparationState);

                scene.lockedRender = true;
                await postRender();

                const rgba = new Uint8Array(width * height * 4);
                const line = new Uint8Array(width * 4);
                await readFrameData(width, height, rgba, line, false);

                const pngBuffer = await ensureCompressor().compress(new Uint32Array(rgba.buffer), width, height);
                const entryName = `frame_${String(frame - startFrame).padStart(digits, '0')}.png`;
                await writeEntry(entryName, new Uint8Array(pngBuffer));

                events.fire('progressUpdate', {
                    text: localize('panel.render.rendering', { ellipsis: true }),
                    progress: 100 * (frame - startFrame + 1) / totalFrames
                });
            }

            if (cancelled) {
                return false;
            }

            const metadata = new TextEncoder().encode(JSON.stringify({
                frameRate,
                totalFrames,
                width,
                height,
                startFrame,
                endFrame,
                pattern: 'frame_%04d.png'
            }, null, 2));
            await writeEntry('sequence.json', metadata);

            await zipFs.close();
            completed = true;
            return true;
        } catch (error) {
            await events.invoke('showPopup', {
                type: 'error',
                header: localize('panel.render.failed'),
                message: `'${(error as any).message ?? error}'`
            });
            return false;
        } finally {
            cancelHandler.off();
            resetOffscreenRender();

            if (!completed && fileStream?.abort) {
                try {
                    await fileStream.abort();
                } catch {
                    // Ignore abort failures so the caller can still clean up the handle.
                }
            }

            events.fire('progressEnd');
        }
    });

    events.function('render.video', (videoSettings: VideoSettings, fileStream: FileSystemWritableFileStream) => {
        const renderImpl = async () => {
            events.fire('progressStart', localize('panel.render.render-video'), true);

            let cancelled = false;
            const cancelHandler = events.on('progressCancel', () => {
                cancelled = true;
            });

            let encoder: VideoEncoder | null = null;

            try {
                const { startFrame, endFrame, frameRate, width, height, bitrate, transparentBg, showDebug, format, codec: codecChoice } = videoSettings;

                const target = fileStream ? new StreamTarget(fileStream) : new BufferTarget();

                // Configure output format and codec from lookup maps (default to mp4/h264)
                const formatConfig = FORMAT_CONFIG[format] ?? FORMAT_CONFIG.mp4;
                const outputFormat = formatConfig.create(!!fileStream);
                const fileExtension = formatConfig.extension;

                const codecConfig = CODEC_CONFIG[codecChoice] ?? CODEC_CONFIG.h264;
                const codecType = codecConfig.type;
                const codec = codecConfig.codec(height);

                const output = new Output({
                    format: outputFormat,
                    target
                });

                const videoSource = new EncodedVideoPacketSource(codecType);
                output.addVideoTrack(videoSource, {
                    rotation: 0,
                    frameRate
                });

                await output.start();

                let encoderError: Error | null = null;

                // helper to create and configure a VideoEncoder instance
                const createEncoder = () => {
                    encoderError = null;
                    const enc = new VideoEncoder({
                        output: async (chunk, meta) => {
                            const encodedPacket = EncodedPacket.fromEncodedChunk(chunk);
                            await videoSource.add(encodedPacket, meta);
                        },
                        error: (error) => {
                            encoderError = error;
                        }
                    });
                    enc.configure({ codec, width, height, bitrate });
                    return enc;
                };

                encoder = createEncoder();

                configureOffscreenRender(width, height, transparentBg, showDebug);

                // cpu-side buffer to read pixels into
                const data = new Uint8Array(width * height * 4);
                const line = new Uint8Array(width * 4);
                const preparationState = createFramePreparationState();

                // capture the current video frame
                const captureFrame = async (frameTime: number) => {
                    await readFrameData(width, height, data, line, true);

                    // construct the video frame
                    const videoFrame = new VideoFrame(data, {
                        format: 'RGBA',
                        codedWidth: width,
                        codedHeight: height,
                        timestamp: Math.floor(1e6 * frameTime),
                        duration: Math.floor(1e6 / frameRate)
                    });

                    // wait for encoder queue to drain if necessary (backpressure handling)
                    while (encoder.encodeQueueSize > 5) {
                        await new Promise<void>((resolve) => {
                            setTimeout(resolve, 1);
                        });
                    }

                    // if the codec was reclaimed (e.g. browser backgrounded the tab),
                    // recreate the encoder and continue
                    let forceKeyFrame = false;
                    if (encoder.state === 'closed' && encoderError?.message?.includes('reclaimed')) {
                        encoder = createEncoder();
                        forceKeyFrame = true;
                    }

                    // check for non-recoverable encoder errors
                    if (encoderError) {
                        videoFrame.close();
                        throw encoderError;
                    }

                    encoder.encode(videoFrame, { keyFrame: forceKeyFrame });
                    videoFrame.close();
                };

                const animFrameRate = events.invoke('timeline.frameRate');
                const duration = (endFrame - startFrame) / animFrameRate;

                for (let frameTime = 0; frameTime <= duration; frameTime += 1.0 / frameRate) {
                    // check for cancellation
                    if (cancelled) break;

                    // prepare the frame (loads PLY if needed, updates camera, sorts)
                    await prepareFrame(startFrame + frameTime * animFrameRate, preparationState);

                    // render a frame
                    scene.lockedRender = true;

                    // wait for render to finish
                    await postRender();

                    // wait for capture
                    await captureFrame(frameTime);

                    events.fire('progressUpdate', {
                        text: localize('panel.render.rendering', { ellipsis: true }),
                        progress: 100 * frameTime / duration
                    });
                }

                // Flush and finalize output
                await encoder.flush();
                await output.finalize();

                // Download (skip if cancelled -- the caller will delete the file)
                if (!cancelled && !fileStream) {
                    const currentSplats = (scene.getElementsByType(ElementType.splat) as Splat[]).filter(splat => splat.visible);
                    downloadFile((output.target as BufferTarget).buffer, `${removeExtension(currentSplats[0]?.name ?? 'supersplat')}.${fileExtension}`);
                }

                return !cancelled;
            } catch (error) {
                await events.invoke('showPopup', {
                    type: 'error',
                    header: localize('panel.render.failed'),
                    message: `'${(error as any).message ?? error}'`
                });
                return false;
            } finally {
                if (encoder && encoder.state !== 'closed') {
                    encoder.close();
                }
                cancelHandler.off();
                resetOffscreenRender();

                events.fire('progressEnd');
            }
        };

        // Acquire a Web Lock during encoding to signal the browser that this tab is
        // actively working, which helps prevent aggressive background throttling and
        // codec reclamation.
        if (navigator.locks) {
            return navigator.locks.request('supersplat-video-render', renderImpl);
        }
        return renderImpl();
    });
};

export { ImageSettings, VideoSettings, SequenceSettings, registerRenderEvents };
