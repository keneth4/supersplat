import { math, Vec3 } from 'playcanvas';

import { CubicSpline } from './anim/spline';
import { AnimTrack } from './anim-track';
import { Camera } from './camera';
import { AnimTrackEditOp, MultiOp, TimelineStateOp } from './edit-ops';
import { Events } from './events';
import { localize } from './ui/localization';

type Pose = {
    name: string,
    frame: number,
    position: Vec3,
    target: Vec3,
    fov?: number
};

type TurntableSettings = {
    elevationDeg: number,
    totalFrames: number,
    frameRate: number,
    fov: number
};

/**
 * Camera animation track that manages camera keyframes and interpolation.
 * Implements AnimTrack interface so it can be used with the timeline system.
 *
 * Fully self-contained: subscribes to timeline events internally for
 * evaluation and spline rebuilding.
 */
class CameraAnimTrack implements AnimTrack {
    private poses: Pose[] = [];
    private events: Events;
    private onTimelineChange: ((frame: number) => void) | null = null;

    constructor(events: Events) {
        this.events = events;

        // Evaluate on timeline playback and scrub
        events.on('timeline.time', (time: number) => {
            this.evaluate(time);
        });

        events.on('timeline.frame', (frame: number) => {
            this.evaluate(frame);
        });

        // Rebuild spline when timeline parameters change
        events.on('timeline.frames', () => {
            this.rebuildSpline();
        });

        events.on('timeline.smoothness', () => {
            this.rebuildSpline();
        });

        // Clear track when scene is cleared
        events.on('scene.clear', () => {
            this.clear();
        });
    }

    get keys(): readonly number[] {
        return this.poses.map(p => p.frame);
    }

    addKey(frame: number): boolean {
        const pose = this.events.invoke('camera.getPose');
        if (!pose) return false;

        const existingIndex = this.poses.findIndex(p => p.frame === frame);

        const newPose: Pose = {
            name: `camera_${this.poses.length}`,
            frame,
            position: new Vec3(pose.position.x, pose.position.y, pose.position.z),
            target: new Vec3(pose.target.x, pose.target.y, pose.target.z),
            fov: pose.fov
        };

        if (existingIndex === -1) {
            this.poses.push(newPose);
            this.rebuildSpline();
            this.events.fire('track.keyAdded', frame);
        } else {
            this.poses[existingIndex] = newPose;
            this.rebuildSpline();
            this.events.fire('track.keyUpdated', frame);
        }
        return true;
    }

    removeKey(frame: number): boolean {
        const index = this.poses.findIndex(p => p.frame === frame);
        if (index === -1) return false;
        this.poses.splice(index, 1);
        this.rebuildSpline();
        this.events.fire('track.keyRemoved', frame);
        return true;
    }

    moveKey(fromFrame: number, toFrame: number): boolean {
        if (fromFrame === toFrame) return false;

        const index = this.poses.findIndex(p => p.frame === fromFrame);
        if (index === -1) return false;

        // Remove any existing pose at the target frame
        const toIndex = this.poses.findIndex(p => p.frame === toFrame);
        if (toIndex !== -1) {
            this.poses.splice(toIndex, 1);
        }

        // Update the frame (re-find index since splice may have shifted it)
        const movedIndex = this.poses.findIndex(p => p.frame === fromFrame);
        this.poses[movedIndex].frame = toFrame;
        this.rebuildSpline();
        this.events.fire('track.keyMoved', fromFrame, toFrame);
        return true;
    }

    copyKey(fromFrame: number, toFrame: number): boolean {
        if (fromFrame === toFrame) return false;

        const source = this.poses.find(p => p.frame === fromFrame);
        if (!source) return false;

        // Remove any existing pose at the target frame
        const toIndex = this.poses.findIndex(p => p.frame === toFrame);
        if (toIndex !== -1) {
            this.poses.splice(toIndex, 1);
        }

        this.poses.push({
            name: `camera_${this.poses.length}`,
            frame: toFrame,
            position: source.position.clone(),
            target: source.target.clone(),
            fov: source.fov
        });

        this.rebuildSpline();
        this.events.fire('track.keyAdded', toFrame);
        return true;
    }

    evaluate(frame: number): void {
        this.onTimelineChange?.(frame);
    }

    clear(): void {
        this.poses.length = 0;
        this.onTimelineChange = null;
        this.events.fire('track.keysCleared');
    }

    snapshot(): Pose[] {
        return this.poses.map(p => ({
            name: p.name,
            frame: p.frame,
            position: p.position.clone(),
            target: p.target.clone(),
            fov: p.fov
        }));
    }

    restore(snapshot: unknown): void {
        this.poses = (snapshot as Pose[]).map(p => ({
            name: p.name,
            frame: p.frame,
            position: p.position.clone(),
            target: p.target.clone(),
            fov: p.fov
        }));
        this.rebuildSpline();
        this.events.fire('track.keysLoaded');
    }

    /**
     * Add a pose directly (used for deserialization and legacy import).
     */
    addPose(pose: Pose): void {
        if (pose.frame === undefined) {
            return;
        }

        pose.fov ??= this.events.invoke('camera.fov') ?? 60;

        const idx = this.poses.findIndex(p => p.frame === pose.frame);
        if (idx !== -1) {
            this.poses[idx] = pose;
            this.rebuildSpline();
            this.events.fire('track.keyUpdated', pose.frame);
        } else {
            this.poses.push(pose);
            this.rebuildSpline();
            this.events.fire('track.keyAdded', pose.frame);
        }
    }

    /**
     * Get all poses (used for serialization and legacy consumers).
     */
    getPoses(): readonly Pose[] {
        return this.poses;
    }

    /**
     * Load poses from serialized data.
     */
    loadPoses(posesData: Pose[]): void {
        this.poses.length = 0;
        posesData.forEach((pose) => {
            this.poses.push(pose);
        });
        this.rebuildSpline();
        this.events.fire('track.keysLoaded');
    }

    private rebuildSpline(): void {
        const duration = this.events.invoke('timeline.frames');
        const smoothness = this.events.invoke('timeline.smoothness');

        const orderedPoses = this.poses.slice()
        .filter(a => a.frame < duration)
        .sort((a, b) => a.frame - b.frame);

        const times = orderedPoses.map(p => p.frame);
        const points: number[] = [];
        for (let i = 0; i < orderedPoses.length; ++i) {
            const p = orderedPoses[i];
            points.push(p.position.x, p.position.y, p.position.z);
            points.push(p.target.x, p.target.y, p.target.z);
            points.push(p.fov);
        }

        if (orderedPoses.length > 1) {
            const spline = CubicSpline.fromPointsLooping(duration, times, points, smoothness);
            const result: number[] = [];
            const pose = { position: new Vec3(), target: new Vec3(), fov: 0 };

            this.onTimelineChange = (frame: number) => {
                spline.evaluate(frame, result);
                pose.position.set(result[0], result[1], result[2]);
                pose.target.set(result[3], result[4], result[5]);
                pose.fov = result[6];
                this.events.fire('camera.setPose', pose, 0);
            };
        } else {
            this.onTimelineChange = null;
        }

        // re-evaluate at the current frame so the camera updates immediately
        this.evaluate(this.events.invoke('timeline.frame'));
    }
}

/**
 * Register the camera animation track and expose it via events.
 * The track is fully self-contained (subscribes to timeline events internally),
 * so this function only needs to create it, expose it, and handle serialization.
 */
const registerCameraPosesEvents = (events: Events) => {
    const track = new CameraAnimTrack(events);
    const forward = new Vec3();
    const offset = new Vec3();
    const turntableFov = 30;
    const turntableOffset = new Vec3();

    const approxNumber = (a: number, b: number, epsilon: number) => {
        return Math.abs(a - b) <= epsilon;
    };

    const approxVec3 = (a: Vec3, b: Vec3, epsilon: number) => {
        return approxNumber(a.x, b.x, epsilon) &&
            approxNumber(a.y, b.y, epsilon) &&
            approxNumber(a.z, b.z, epsilon);
    };

    const normalizeDegrees180 = (degrees: number) => {
        return (((degrees + 180) % 360) + 360) % 360 - 180;
    };

    const getTurntableAngles = (pose: Pose, target: Vec3, radius: number) => {
        turntableOffset.sub2(pose.position, target).mulScalar(1 / radius);

        return {
            azim: Math.atan2(turntableOffset.x, turntableOffset.z) * math.RAD_TO_DEG,
            elev: -Math.asin(math.clamp(turntableOffset.y, -1, 1)) * math.RAD_TO_DEG
        };
    };

    const getCompatibleTurntableSnapshot = (snapshot: Pose[]) => {
        const timelineFrames = events.invoke('timeline.frames') as number;
        const ordered = snapshot.slice().sort((a, b) => a.frame - b.frame);

        if (ordered.length <= 1 || ordered.length !== timelineFrames) {
            return null;
        }

        if (!ordered.every((pose, index) => pose.frame === index)) {
            return null;
        }

        const baseTarget = ordered[0].target;
        const baseFov = ordered[0].fov ?? turntableFov;
        offset.sub2(ordered[0].position, baseTarget);
        const baseRadius = offset.length();

        if (!isFinite(baseRadius) || baseRadius <= 0) {
            return null;
        }

        const positionEpsilon = Math.max(1e-4, baseRadius * 1e-4);
        const baseAngles = getTurntableAngles(ordered[0], baseTarget, baseRadius);
        const angleEpsilon = 1e-2;
        const step = 360 / ordered.length;

        for (let i = 0; i < ordered.length; i++) {
            const pose = ordered[i];
            const poseFov = pose.fov ?? turntableFov;

            if (!approxVec3(pose.target, baseTarget, positionEpsilon)) {
                return null;
            }

            if (!approxNumber(poseFov, baseFov, angleEpsilon)) {
                return null;
            }

            offset.sub2(pose.position, pose.target);
            const radius = offset.length();
            if (!isFinite(radius) || !approxNumber(radius, baseRadius, positionEpsilon)) {
                return null;
            }

            const angles = getTurntableAngles(pose, baseTarget, baseRadius);
            if (!approxNumber(angles.elev, baseAngles.elev, angleEpsilon)) {
                return null;
            }

            const expectedAzim = baseAngles.azim + step * i;
            if (Math.abs(normalizeDegrees180(angles.azim - expectedAzim)) > angleEpsilon) {
                return null;
            }
        }

        return ordered;
    };

    const rotateTurntableSnapshot = (ordered: Pose[], startFrame: number) => {
        return ordered.map((_, index) => {
            const source = ordered[(startFrame + index) % ordered.length];

            return {
                name: source.name,
                frame: index,
                position: source.position.clone(),
                target: source.target.clone(),
                fov: source.fov
            };
        });
    };

    const getTurntableRadius = (ordered: Pose[]) => {
        offset.sub2(ordered[0].position, ordered[0].target);
        return offset.length();
    };

    const rescaleTurntableSnapshot = (ordered: Pose[], radius: number) => {
        return ordered.map((pose) => {
            offset.sub2(pose.position, pose.target);

            return {
                name: pose.name,
                frame: pose.frame,
                position: pose.target.clone().add(offset.normalize().mulScalar(radius)),
                target: pose.target.clone(),
                fov: pose.fov
            };
        });
    };

    const buildTurntableSnapshot = (settings: TurntableSettings) => {
        const pose = events.invoke('camera.getPose');
        if (!pose) {
            return null;
        }

        const target = new Vec3(pose.target.x, pose.target.y, pose.target.z);
        const position = new Vec3(pose.position.x, pose.position.y, pose.position.z);
        const radius = position.distance(target);

        if (!isFinite(radius) || radius <= 0) {
            return null;
        }

        offset.sub2(target, position);
        const length = offset.length();
        const startAzim = Math.atan2(-offset.x / length, -offset.z / length) * math.RAD_TO_DEG;
        const step = 360 / settings.totalFrames;
        const fov = isFinite(settings.fov) && settings.fov > 0 ? settings.fov : (pose.fov ?? turntableFov);

        return Array.from({ length: settings.totalFrames }, (_, frame) => {
            Camera.calcForwardVec(forward, startAzim + step * frame, settings.elevationDeg);

            return {
                name: `camera_${frame}`,
                frame,
                position: target.clone().add(forward.clone().mulScalar(radius)),
                target: target.clone(),
                fov
            };
        });
    };

    const getSuggestedTurntableSettings = (): TurntableSettings => {
        const timelineFrames = (events.invoke('timeline.frames') as number) ?? 120;
        const timelineFrameRate = (events.invoke('timeline.frameRate') as number) ?? 24;
        const pose = events.invoke('camera.getPose');
        const currentFov = (events.invoke('camera.fov') as number) ?? turntableFov;

        if (!pose) {
            return {
                elevationDeg: -45,
                totalFrames: timelineFrames,
                frameRate: timelineFrameRate,
                fov: isFinite(currentFov) && currentFov > 0 ? currentFov : turntableFov
            };
        }

        const target = new Vec3(pose.target.x, pose.target.y, pose.target.z);
        const position = new Vec3(pose.position.x, pose.position.y, pose.position.z);
        const radius = position.distance(target);

        if (!isFinite(radius) || radius <= 0) {
            return {
                elevationDeg: -45,
                totalFrames: timelineFrames,
                frameRate: timelineFrameRate,
                fov: isFinite(pose.fov) && pose.fov > 0 ? pose.fov : (isFinite(currentFov) && currentFov > 0 ? currentFov : turntableFov)
            };
        }

        const { elev } = getTurntableAngles({
            name: 'camera',
            frame: 0,
            position,
            target,
            fov: pose.fov
        }, target, radius);

        return {
            elevationDeg: isFinite(elev) ? Math.round(elev) : -45,
            totalFrames: timelineFrames,
            frameRate: timelineFrameRate,
            fov: isFinite(pose.fov) && pose.fov > 0 ? pose.fov : (isFinite(currentFov) && currentFov > 0 ? currentFov : turntableFov)
        };
    };

    // Expose the camera animation track
    events.function('camera.animTrack', () => {
        return track;
    });

    // Legacy support: expose poses
    events.function('camera.poses', () => {
        return track.getPoses();
    });

    events.function('camera.turntable.suggestSettings', () => {
        return getSuggestedTurntableSettings();
    });

    events.function('camera.generateTurntable', (settings: TurntableSettings) => {
        if (settings.totalFrames < 1 || settings.frameRate < 1 || !isFinite(settings.fov) || settings.fov <= 0) {
            return false;
        }

        const beforeTrack = track.snapshot();
        const afterTrack = buildTurntableSnapshot(settings);

        if (!afterTrack) {
            return false;
        }

        const beforeTimeline = events.invoke('docSerialize.timeline');
        const afterTimeline = {
            ...beforeTimeline,
            frames: settings.totalFrames,
            frameRate: settings.frameRate,
            frame: 0,
            smoothness: 0
        };

        events.invoke('docDeserialize.timeline', afterTimeline);
        track.restore(afterTrack);

        events.fire('edit.add', new MultiOp([
            new TimelineStateOp('turntableTimeline', events, beforeTimeline, afterTimeline),
            new AnimTrackEditOp('generateTurntable', track, beforeTrack, afterTrack)
        ]), true);

        return true;
    });

    events.function('camera.turntable.canSetCurrentAsStart', () => {
        return !!getCompatibleTurntableSnapshot(track.snapshot());
    });

    events.function('camera.turntable.distance', () => {
        const compatibleTurntable = getCompatibleTurntableSnapshot(track.snapshot());
        return compatibleTurntable ? getTurntableRadius(compatibleTurntable) : null;
    });

    events.function('camera.turntable.setDistance', (distance: number) => {
        if (!isFinite(distance) || distance <= 0) {
            return false;
        }

        const beforeTrack = track.snapshot();
        const compatibleTurntable = getCompatibleTurntableSnapshot(beforeTrack);

        if (!compatibleTurntable) {
            return false;
        }

        const currentDistance = getTurntableRadius(compatibleTurntable);
        if (approxNumber(currentDistance, distance, Math.max(1e-6, currentDistance * 1e-6))) {
            return true;
        }

        const afterTrack = rescaleTurntableSnapshot(compatibleTurntable, distance);
        track.restore(afterTrack);

        events.fire('edit.add', new AnimTrackEditOp('setTurntableDistance', track, beforeTrack, afterTrack), true);

        return true;
    });

    events.function('camera.turntable.setCurrentAsStart', async () => {
        const beforeTrack = track.snapshot();
        const compatibleTurntable = getCompatibleTurntableSnapshot(beforeTrack);

        if (!compatibleTurntable) {
            await events.invoke('showPopup', {
                type: 'error',
                header: localize('popup.turntable-start.header'),
                message: localize('popup.turntable-start.invalid')
            });
            return false;
        }

        const currentFrame = events.invoke('timeline.frame') as number;
        if (currentFrame === 0) {
            return true;
        }

        const afterTrack = rotateTurntableSnapshot(compatibleTurntable, currentFrame);
        const beforeTimeline = events.invoke('docSerialize.timeline');
        const afterTimeline = {
            ...beforeTimeline,
            frame: 0
        };

        track.restore(afterTrack);
        events.invoke('docDeserialize.timeline', afterTimeline);

        events.fire('edit.add', new MultiOp([
            new TimelineStateOp('turntableStartTimeline', events, beforeTimeline, afterTimeline),
            new AnimTrackEditOp('setTurntableStart', track, beforeTrack, afterTrack)
        ]), true);

        return true;
    });

    // Legacy support: add pose directly
    events.on('camera.addPose', (pose: Pose) => {
        track.addPose(pose);
    });

    // Serialization

    events.function('docSerialize.poseSets', (): any[] => {
        const pack3 = (v: Vec3) => [v.x, v.y, v.z];
        const poses = track.getPoses();

        if (poses.length === 0) {
            return [];
        }

        return [{
            name: 'set0',
            poses: poses.map((pose) => {
                return {
                    name: pose.name,
                    frame: pose.frame,
                    position: pack3(pose.position),
                    target: pack3(pose.target),
                    fov: pose.fov
                };
            })
        }];
    });

    events.function('docDeserialize.poseSets', (poseSets: any[], documentCameraFov?: number) => {
        if (!poseSets || poseSets.length === 0) {
            return;
        }

        const fps = events.invoke('timeline.frameRate');

        const defaultFov = documentCameraFov ?? events.invoke('camera.fov') ?? 60;

        const loadedPoses: Pose[] = poseSets[0].poses.map((docPose: any, index: number) => {
            return {
                name: docPose.name,
                frame: docPose.frame ?? (index * fps),
                position: new Vec3(docPose.position),
                target: new Vec3(docPose.target),
                fov: docPose.fov ?? defaultFov
            };
        });

        track.loadPoses(loadedPoses);
    });
};

export { registerCameraPosesEvents, CameraAnimTrack, Pose };
export type { TurntableSettings };
