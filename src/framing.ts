type FramingSettings = {
    enabled: boolean;
    width: number;
    height: number;
    dimOutside: boolean;
};

const defaultFramingSettings: FramingSettings = {
    enabled: false,
    width: 500,
    height: 500,
    dimOutside: true
};

export { FramingSettings, defaultFramingSettings };
