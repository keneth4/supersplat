import { BooleanInput, Button, Container, Element, Label, VectorInput } from '@playcanvas/pcui';
import { path } from 'playcanvas';

import { Events } from '../events';
import { defaultFramingSettings, type FramingSettings } from '../framing';
import { SequenceSettings } from '../render';
import { localize } from './localization';
import sceneExport from './svg/export.svg';

const createSvg = (svgString: string, args = {}) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new Element({
        dom: new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement,
        ...args
    });
};

const removeExtension = (filename: string) => {
    return filename.substring(0, filename.length - path.getExtension(filename).length);
};

class SequenceSettingsDialog extends Container {
    show: () => Promise<SequenceSettings | null>;
    hide: () => void;
    destroy: () => void;

    constructor(events: Events, args = {}) {
        args = {
            ...args,
            id: 'sequence-settings-dialog',
            class: 'settings-dialog',
            hidden: true,
            tabIndex: -1
        };

        super(args);

        const dialog = new Container({
            id: 'dialog'
        });

        const headerIcon = createSvg(sceneExport, { id: 'icon' });
        const headerText = new Label({ id: 'text', text: localize('popup.render-sequence.header').toUpperCase() });
        const header = new Container({ id: 'header' });
        header.append(headerIcon);
        header.append(headerText);

        const resolutionLabel = new Label({ class: 'label', text: localize('popup.render-sequence.resolution') });
        const resolutionValue = new VectorInput({
            class: 'vector-input',
            dimensions: 2,
            min: 4,
            max: 16000,
            precision: 0,
            value: [500, 500]
        });
        const resolutionRow = new Container({ class: 'row' });
        resolutionRow.append(resolutionLabel);
        resolutionRow.append(resolutionValue);

        const lockAspectLabel = new Label({ class: 'label', text: localize('popup.render-sequence.lock-square') });
        const lockAspectToggle = new BooleanInput({ class: 'boolean', value: true });
        const lockAspectRow = new Container({ class: 'row' });
        lockAspectRow.append(lockAspectLabel);
        lockAspectRow.append(lockAspectToggle);

        const frameRangeLabel = new Label({ class: 'label', text: localize('popup.render-sequence.frame-range') });
        const frameRangeInput = new VectorInput({
            class: 'vector-input',
            dimensions: 2,
            min: 0,
            max: 0,
            precision: 0,
            placeholder: [localize('popup.render-sequence.frame-range-first'), localize('popup.render-sequence.frame-range-last')],
            value: [0, 0]
        });
        const frameRangeRow = new Container({ class: 'row' });
        frameRangeRow.append(frameRangeLabel);
        frameRangeRow.append(frameRangeInput);

        const transparentBgLabel = new Label({ class: 'label', text: localize('popup.render-sequence.transparent-bg') });
        const transparentBgToggle = new BooleanInput({ class: 'boolean', value: true });
        const transparentBgRow = new Container({ class: 'row' });
        transparentBgRow.append(transparentBgLabel);
        transparentBgRow.append(transparentBgToggle);

        const showDebugLabel = new Label({ class: 'label', text: localize('popup.render-sequence.show-debug') });
        const showDebugToggle = new BooleanInput({ class: 'boolean', value: false });
        const showDebugRow = new Container({ class: 'row' });
        showDebugRow.append(showDebugLabel);
        showDebugRow.append(showDebugToggle);

        const content = new Container({ id: 'content' });
        content.append(resolutionRow);
        content.append(lockAspectRow);
        content.append(frameRangeRow);
        content.append(transparentBgRow);
        content.append(showDebugRow);

        const footer = new Container({ id: 'footer' });
        const cancelButton = new Button({
            class: 'button',
            text: localize('panel.render.cancel')
        });
        const okButton = new Button({
            class: 'button',
            text: localize('panel.render.ok')
        });
        footer.append(cancelButton);
        footer.append(okButton);

        dialog.append(header);
        dialog.append(content);
        dialog.append(footer);
        this.append(dialog);

        let onCancel: () => void;
        let onOK: () => void;
        let lastResolution: [number, number] = [500, 500];
        let syncingResolution = false;

        const setResolution = (nextValue: [number, number]) => {
            syncingResolution = true;
            resolutionValue.value = nextValue;
            syncingResolution = false;
            lastResolution = nextValue;
        };

        resolutionValue.on('change', (value: number[]) => {
            if (syncingResolution) {
                return;
            }

            const nextValue: [number, number] = [value[0], value[1]];

            if (lockAspectToggle.value && nextValue[0] !== nextValue[1]) {
                const widthDelta = Math.abs(nextValue[0] - lastResolution[0]);
                const heightDelta = Math.abs(nextValue[1] - lastResolution[1]);
                const lockedValue = widthDelta >= heightDelta ? nextValue[0] : nextValue[1];
                setResolution([lockedValue, lockedValue]);
                return;
            }

            lastResolution = nextValue;
        });

        lockAspectToggle.on('change', (value: boolean) => {
            if (value) {
                const [width, height] = resolutionValue.value as number[];
                if (width !== height) {
                    setResolution([width, width]);
                }
            }
        });

        frameRangeInput.on('change', (value: number[]) => {
            if (value[0] > value[1]) {
                frameRangeInput.value = [value[1], value[0]];
            }
        });

        cancelButton.on('click', () => onCancel());
        okButton.on('click', () => onOK());

        const keydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            }
        };

        const reset = () => {
            const totalFrames = events.invoke('timeline.frames') as number;
            const framing = (events.invoke('view.framing') as FramingSettings | undefined) ?? defaultFramingSettings;

            frameRangeInput.max = Math.max(0, totalFrames - 1);
            frameRangeInput.value = [0, Math.max(0, totalFrames - 1)];
            lockAspectToggle.value = framing.width === framing.height;
            setResolution([framing.width, framing.height]);
            transparentBgToggle.value = true;
            showDebugToggle.value = false;
        };

        this.show = () => {
            reset();

            this.hidden = false;
            document.addEventListener('keydown', keydown);
            this.dom.focus();

            return new Promise<SequenceSettings | null>((resolve) => {
                onCancel = () => {
                    resolve(null);
                };

                onOK = () => {
                    const [width, height] = resolutionValue.value as number[];
                    const [startFrame, endFrame] = frameRangeInput.value as number[];
                    const docName = events.invoke('doc.name') as string | null;

                    resolve({
                        startFrame,
                        endFrame,
                        width,
                        height,
                        transparentBg: transparentBgToggle.value,
                        showDebug: showDebugToggle.value,
                        zipBasename: removeExtension(docName ?? 'supersplat')
                    });
                };
            }).finally(() => {
                document.removeEventListener('keydown', keydown);
                this.hide();
            });
        };

        this.hide = () => {
            this.hidden = true;
        };

        this.destroy = () => {
            this.hide();
            super.destroy();
        };
    }
}

export { SequenceSettingsDialog };
