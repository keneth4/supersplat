import { BooleanInput, Button, Container, Element, Label, NumericInput, SelectInput, VectorInput } from '@playcanvas/pcui';

import { Events } from '../events';
import type { ImportFile } from '../file-handler';
import { localize } from './localization';
import food360Svg from './svg/food360.svg';

type Food360Settings = {
    files: ImportFile[];
    elevationDeg: number;
    totalFrames: number;
    frameRate: number;
    fov: number;
    width: number;
    height: number;
    showFrame: boolean;
};

const createSvg = (svgString: string, args = {}) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new Element({
        dom: new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement,
        ...args
    });
};

const summarizeFiles = (files: ImportFile[]) => {
    if (files.length === 0) {
        return localize('popup.food360.no-file');
    }

    if (files.length === 1) {
        return files[0].filename;
    }

    return `${files[0].filename} +${files.length - 1}`;
};

class Food360WizardDialog extends Container {
    show: () => Promise<Food360Settings | null>;
    hide: () => void;
    destroy: () => void;

    constructor(events: Events, args = {}) {
        args = {
            ...args,
            id: 'food360-wizard-dialog',
            class: 'settings-dialog',
            hidden: true,
            tabIndex: -1
        };

        super(args);

        const dialog = new Container({
            id: 'dialog'
        });

        const headerIcon = createSvg(food360Svg, { id: 'icon' });
        const headerText = new Label({ id: 'text', text: localize('popup.food360.header').toUpperCase() });
        const header = new Container({ id: 'header' });
        header.append(headerIcon);
        header.append(headerText);

        const fileLabel = new Label({ class: 'label', text: localize('popup.food360.file') });
        const fileControls = new Container({ class: 'input-group' });
        const fileValue = new Label({ class: 'file-value', text: localize('popup.food360.no-file') });
        const browseButton = new Button({
            class: 'button-inline',
            text: localize('popup.food360.browse')
        });
        fileControls.append(fileValue);
        fileControls.append(browseButton);
        const fileRow = new Container({ class: 'row' });
        fileRow.append(fileLabel);
        fileRow.append(fileControls);

        const elevationLabel = new Label({ class: 'label', text: localize('popup.food360.elevation') });
        const elevationInput = new NumericInput({
            class: 'numeric-input',
            min: -89,
            max: 89,
            precision: 0,
            value: -45
        });
        const elevationRow = new Container({ class: 'row' });
        elevationRow.append(elevationLabel);
        elevationRow.append(elevationInput);

        const framesLabel = new Label({ class: 'label', text: localize('popup.food360.total-frames') });
        const framesInput = new NumericInput({
            class: 'numeric-input',
            min: 1,
            max: 10000,
            precision: 0,
            value: 120
        });
        const framesRow = new Container({ class: 'row' });
        framesRow.append(framesLabel);
        framesRow.append(framesInput);

        const frameRateLabel = new Label({ class: 'label', text: localize('popup.food360.frame-rate') });
        const frameRateSelect = new SelectInput({
            class: 'select',
            defaultValue: '24',
            options: [
                { v: '12', t: '12 fps' },
                { v: '15', t: '15 fps' },
                { v: '24', t: '24 fps' },
                { v: '25', t: '25 fps' },
                { v: '30', t: '30 fps' },
                { v: '48', t: '48 fps' },
                { v: '60', t: '60 fps' },
                { v: '120', t: '120 fps' }
            ]
        });
        const frameRateRow = new Container({ class: 'row' });
        frameRateRow.append(frameRateLabel);
        frameRateRow.append(frameRateSelect);

        const fovLabel = new Label({ class: 'label', text: localize('popup.food360.fov') });
        const fovInput = new NumericInput({
            class: 'numeric-input',
            min: 10,
            max: 120,
            precision: 0,
            value: 30
        });
        const fovRow = new Container({ class: 'row' });
        fovRow.append(fovLabel);
        fovRow.append(fovInput);

        const resolutionLabel = new Label({ class: 'label', text: localize('popup.food360.resolution') });
        const resolutionInput = new VectorInput({
            class: 'vector-input',
            dimensions: 2,
            min: 4,
            max: 16000,
            precision: 0,
            value: [500, 500]
        });
        const resolutionRow = new Container({ class: 'row' });
        resolutionRow.append(resolutionLabel);
        resolutionRow.append(resolutionInput);

        const showFrameLabel = new Label({ class: 'label', text: localize('popup.food360.show-frame') });
        const showFrameToggle = new BooleanInput({
            class: 'boolean',
            value: true
        });
        const showFrameRow = new Container({ class: 'row' });
        showFrameRow.append(showFrameLabel);
        showFrameRow.append(showFrameToggle);

        const content = new Container({ id: 'content' });
        content.append(fileRow);
        content.append(elevationRow);
        content.append(framesRow);
        content.append(frameRateRow);
        content.append(fovRow);
        content.append(resolutionRow);
        content.append(showFrameRow);

        const footer = new Container({ id: 'footer' });
        const cancelButton = new Button({
            class: 'button',
            text: localize('panel.render.cancel')
        });
        const startButton = new Button({
            class: 'button',
            text: localize('popup.food360.start'),
            enabled: false
        });
        footer.append(cancelButton);
        footer.append(startButton);

        dialog.append(header);
        dialog.append(content);
        dialog.append(footer);
        this.append(dialog);

        let selectedFiles: ImportFile[] | null = null;
        let onCancel: () => void;
        let onStart: () => void;

        const hasReusableScene = () => {
            return ((events.invoke('scene.splats') as unknown[] | undefined) ?? []).length > 0;
        };

        const updateSelectedFiles = (files: ImportFile[] | null) => {
            selectedFiles = files;
            fileValue.text = files?.length ? summarizeFiles(files) :
                (hasReusableScene() ? localize('popup.food360.current-scene') : localize('popup.food360.no-file'));
            startButton.enabled = !!files?.length || hasReusableScene();
        };

        browseButton.on('click', async () => {
            const files = await events.invoke('scene.pickFood360Files') as ImportFile[] | null;
            if (files?.length) {
                updateSelectedFiles(files);
            }
        });

        cancelButton.on('click', () => onCancel());
        startButton.on('click', () => onStart());

        const keydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            }
        };

        const reset = () => {
            updateSelectedFiles(null);
            elevationInput.value = -45;
            framesInput.value = 120;
            frameRateSelect.value = '24';
            fovInput.value = 30;
            resolutionInput.value = [500, 500];
            showFrameToggle.value = true;
        };

        this.show = () => {
            reset();

            this.hidden = false;
            document.addEventListener('keydown', keydown);
            this.dom.focus();

            return new Promise<Food360Settings | null>((resolve) => {
                onCancel = () => {
                    resolve(null);
                };

                onStart = () => {
                    const [width, height] = resolutionInput.value as number[];

                    resolve({
                        files: selectedFiles ?? [],
                        elevationDeg: elevationInput.value,
                        totalFrames: framesInput.value,
                        frameRate: parseInt(frameRateSelect.value, 10),
                        fov: fovInput.value,
                        width,
                        height,
                        showFrame: showFrameToggle.value
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

export { Food360WizardDialog };
export type { Food360Settings };
