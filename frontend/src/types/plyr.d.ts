declare module "plyr" {
  interface Source {
    src: string;
    type?: string;
    provider?: "youtube" | "vimeo" | "html5";
    poster?: string;
  }
  interface SourceInfo {
    type: "video" | "audio";
    title?: string;
    sources: Source[];
    poster?: string;
    tracks?: Track[];
  }
  interface Track {
    kind: string;
    label: string;
    srclang: string;
    src: string;
    default?: boolean;
  }
  interface Options {
    controls?: string[] | string | boolean;
    settings?: string[];
    i18n?: Record<string, unknown>;
    loadSprite?: boolean;
    iconUrl?: string;
    iconPrefix?: string;
    blankUrl?: string;
    blankVideo?: string;
    autoplay?: boolean;
    loop?: { active: boolean };
    speed?: { selected?: number; options?: number[] };
    volume?: number;
    muted?: boolean;
    clickToPlay?: boolean;
    disableContextMenu?: boolean;
    hideControls?: boolean;
    resetOnEnd?: boolean;
    keyboard?: { focused?: boolean; global?: boolean };
    tooltips?: { controls?: boolean; seek?: boolean };
    duration?: number;
    displayDuration?: boolean;
    invertTime?: boolean;
    toggleInvert?: boolean;
    ratio?: string;
    ads?: { enabled?: boolean; publisherId?: string; tagUrl?: string };
    youtube?: { noCookie?: boolean; rel?: number; showinfo?: boolean; ivLoadPolicy?: number; modestBranding?: number };
    vimeo?: { byline?: boolean; portrait?: boolean; title?: boolean; speed?: boolean; transparent?: boolean };
  }
  interface PlyrEvent {
    detail: { plyr: Plyr };
  }
  type TimeUpdate = { currentTime: number; played: number; duration: number; buffered: number };
  export default class Plyr {
    constructor(element: HTMLElement, options?: Options);
    source: SourceInfo | null;
    options: Options;
    currentTime: number;
    duration: number;
    paused: boolean;
    playing: boolean;
    stopped: boolean;
    ended: boolean;
    volume: number;
    muted: boolean;
    speed: number;
    fullscreen: boolean;
    poster: string;
    static setup(elements: HTMLElement | NodeListOf<HTMLElement> | string, options?: Options): Plyr[];
    play(): Promise<void>;
    pause(): void;
    stop(): void;
    restart(): void;
    rewind(seekTime?: number): void;
    forward(seekTime?: number): void;
    increaseVolume(step?: number): void;
    decreaseVolume(step?: number): void;
    airplay(): void;
    toggleControls(toggle?: boolean): void;
    toggleCaptions(toggle?: boolean): void;
    enterFullscreen(): void;
    exitFullscreen(): void;
    toggleFullscreen(toggle?: boolean): void;
    destroy(): void;
    on(event: string, callback: (event: PlyrEvent) => void): void;
    once(event: string, callback: (event: PlyrEvent) => void): void;
    off(event: string, callback: (event: PlyrEvent) => void): void;
  }
}
