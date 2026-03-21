import { Button, Container, Element, Label, NumericInput, SelectInput } from '@playcanvas/pcui';

import { TurntableSettings } from '../camera-poses';
import { Events } from '../events';
import { localize } from './localization';
import sceneExport from './svg/export.svg';

const createSvg = (svgString: string, args = {}) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new Element({
        dom: new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement,
        ...args
    });
};

class TurntableSettingsDialog extends Container {
    show: () => Promise<TurntableSettings | null>;
    hide: () => void;
    destroy: () => void;

    constructor(events: Events, args = {}) {
        args = {
            ...args,
            id: 'turntable-settings-dialog',
            class: 'settings-dialog',
            hidden: true,
            tabIndex: -1
        };

        super(args);

        const dialog = new Container({
            id: 'dialog'
        });

        const headerIcon = createSvg(sceneExport, { id: 'icon' });
        const headerText = new Label({ id: 'text', text: localize('popup.turntable.header').toUpperCase() });
        const header = new Container({ id: 'header' });
        header.append(headerIcon);
        header.append(headerText);

        const elevationLabel = new Label({ class: 'label', text: localize('popup.turntable.elevation') });
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

        const framesLabel = new Label({ class: 'label', text: localize('popup.turntable.total-frames') });
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

        const frameRateLabel = new Label({ class: 'label', text: localize('popup.turntable.frame-rate') });
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

        const content = new Container({ id: 'content' });
        content.append(elevationRow);
        content.append(framesRow);
        content.append(frameRateRow);

        const footer = new Container({ id: 'footer' });
        const cancelButton = new Button({
            class: 'button',
            text: localize('popup.cancel')
        });
        const okButton = new Button({
            class: 'button',
            text: localize('popup.turntable.generate')
        });
        footer.append(cancelButton);
        footer.append(okButton);

        dialog.append(header);
        dialog.append(content);
        dialog.append(footer);
        this.append(dialog);

        let onCancel: () => void;
        let onOK: () => void;

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
            elevationInput.value = -45;
            framesInput.value = 120;
            frameRateSelect.value = '24';
        };

        this.show = () => {
            reset();

            this.hidden = false;
            document.addEventListener('keydown', keydown);
            this.dom.focus();

            return new Promise<TurntableSettings | null>((resolve) => {
                onCancel = () => {
                    resolve(null);
                };

                onOK = () => {
                    resolve({
                        elevationDeg: elevationInput.value,
                        totalFrames: framesInput.value,
                        frameRate: parseInt(frameRateSelect.value, 10)
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

export { TurntableSettingsDialog };
