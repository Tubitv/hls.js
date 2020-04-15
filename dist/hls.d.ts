import { ErrorTypes, ErrorDetails } from './errors';
import { HlsConfig } from './config';
import { Observer } from './observer';
/**
 * @module Hls
 * @class
 * @constructor
 */
export default class Hls extends Observer {
    static defaultConfig?: HlsConfig;
    config: HlsConfig;
    private _autoLevelCapping;
    private abrController;
    private capLevelController;
    private levelController;
    private streamController;
    private networkControllers;
    private audioTrackController;
    private subtitleTrackController;
    private emeController;
    private coreComponents;
    private media;
    private url;
    /**
     * @type {string}
     */
    static get version(): string;
    /**
     * @type {boolean}
     */
    static isSupported(): boolean;
    /**
     * @type {HlsEvents}
     */
    static get Events(): any;
    /**
     * @type {HlsErrorTypes}
     */
    static get ErrorTypes(): typeof ErrorTypes;
    /**
     * @type {HlsErrorDetails}
     */
    static get ErrorDetails(): typeof ErrorDetails;
    /**
     * @type {HlsConfig}
     */
    static get DefaultConfig(): HlsConfig;
    /**
     * @type {HlsConfig}
     */
    static set DefaultConfig(defaultConfig: HlsConfig);
    /**
     * Creates an instance of an HLS client that can attach to exactly one `HTMLMediaElement`.
     *
     * @constructs Hls
     * @param {HlsConfig} config
     */
    constructor(userConfig?: Partial<HlsConfig>);
    /**
     * Dispose of the instance
     */
    destroy(): void;
    /**
     * Attach a media element
     * @param {HTMLMediaElement} media
     */
    attachMedia(media: HTMLMediaElement): void;
    /**
     * Detach from the media
     */
    detachMedia(): void;
    /**
     * Set the source URL. Can be relative or absolute.
     * @param {string} url
     */
    loadSource(url: string): void;
    /**
     * Start loading data from the stream source.
     * Depending on default config, client starts loading automatically when a source is set.
     *
     * @param {number} startPosition Set the start position to stream from
     * @default -1 None (from earliest point)
     */
    startLoad(startPosition?: number): void;
    /**
     * Stop loading of any stream data.
     */
    stopLoad(): void;
    /**
     * Swap through possible audio codecs in the stream (for example to switch from stereo to 5.1)
     */
    swapAudioCodec(): void;
    /**
     * When the media-element fails, this allows to detach and then re-attach it
     * as one call (convenience method).
     *
     * Automatic recovery of media-errors by this process is configurable.
     */
    recoverMediaError(): void;
    /**
     * @type {QualityLevel[]}
     */
    get levels(): any[];
    /**
     * Index of quality level currently played
     * @type {number}
     */
    get currentLevel(): number;
    /**
     * Set quality level index immediately .
     * This will flush the current buffer to replace the quality asap.
     * That means playback will interrupt at least shortly to re-buffer and re-sync eventually.
     * @type {number} -1 for automatic level selection
     */
    set currentLevel(newLevel: number);
    /**
     * Index of next quality level loaded as scheduled by stream controller.
     * @type {number}
     */
    get nextLevel(): number;
    /**
     * Set quality level index for next loaded data.
     * This will switch the video quality asap, without interrupting playback.
     * May abort current loading of data, and flush parts of buffer (outside currently played fragment region).
     * @type {number} -1 for automatic level selection
     */
    set nextLevel(newLevel: number);
    /**
     * Return the quality level of the currently or last (of none is loaded currently) segment
     * @type {number}
     */
    get loadLevel(): number;
    /**
     * Set quality level index for next loaded data in a conservative way.
     * This will switch the quality without flushing, but interrupt current loading.
     * Thus the moment when the quality switch will appear in effect will only be after the already existing buffer.
     * @type {number} newLevel -1 for automatic level selection
     */
    set loadLevel(newLevel: number);
    /**
     * get next quality level loaded
     * @type {number}
     */
    get nextLoadLevel(): number;
    /**
     * Set quality level of next loaded segment in a fully "non-destructive" way.
     * Same as `loadLevel` but will wait for next switch (until current loading is done).
     * @type {number} level
     */
    set nextLoadLevel(level: number);
    /**
     * Return "first level": like a default level, if not set,
     * falls back to index of first level referenced in manifest
     * @type {number}
     */
    get firstLevel(): number;
    /**
     * Sets "first-level", see getter.
     * @type {number}
     */
    set firstLevel(newLevel: number);
    /**
     * Return start level (level of first fragment that will be played back)
     * if not overrided by user, first level appearing in manifest will be used as start level
     * if -1 : automatic start level selection, playback will start from level matching download bandwidth
     * (determined from download of first segment)
     * @type {number}
     */
    get startLevel(): number;
    /**
     * set  start level (level of first fragment that will be played back)
     * if not overrided by user, first level appearing in manifest will be used as start level
     * if -1 : automatic start level selection, playback will start from level matching download bandwidth
     * (determined from download of first segment)
     * @type {number} newLevel
     */
    set startLevel(newLevel: number);
    /**
     * set  dynamically set capLevelToPlayerSize against (`CapLevelController`)
     *
     * @type {boolean}
     */
    set capLevelToPlayerSize(shouldStartCapping: boolean);
    /**
     * Capping/max level value that should be used by automatic level selection algorithm (`ABRController`)
     * @type {number}
     */
    get autoLevelCapping(): number;
    /**
     * get bandwidth estimate
     * @type {number}
     */
    get bandwidthEstimate(): number;
    /**
     * Capping/max level value that should be used by automatic level selection algorithm (`ABRController`)
     * @type {number}
     */
    set autoLevelCapping(newLevel: number);
    /**
     * True when automatic level selection enabled
     * @type {boolean}
     */
    get autoLevelEnabled(): boolean;
    /**
     * Level set manually (if any)
     * @type {number}
     */
    get manualLevel(): number;
    /**
     * min level selectable in auto mode according to config.minAutoBitrate
     * @type {number}
     */
    get minAutoLevel(): number;
    /**
     * max level selectable in auto mode according to autoLevelCapping
     * @type {number}
     */
    get maxAutoLevel(): number;
    /**
     * next automatically selected quality level
     * @type {number}
     */
    get nextAutoLevel(): number;
    /**
     * this setter is used to force next auto level.
     * this is useful to force a switch down in auto mode:
     * in case of load error on level N, hls.js can set nextAutoLevel to N-1 for example)
     * forced value is valid for one fragment. upon succesful frag loading at forced level,
     * this value will be resetted to -1 by ABR controller.
     * @type {number}
     */
    set nextAutoLevel(nextLevel: number);
    /**
     * @type {AudioTrack[]}
     */
    get audioTracks(): any[];
    /**
     * index of the selected audio track (index in audio track lists)
     * @type {number}
     */
    get audioTrack(): number;
    /**
     * selects an audio track, based on its index in audio track lists
     * @type {number}
     */
    set audioTrack(audioTrackId: number);
    /**
     * @type {Seconds}
     */
    get liveSyncPosition(): number;
    /**
     * get alternate subtitle tracks list from playlist
     * @type {SubtitleTrack[]}
     */
    get subtitleTracks(): any[];
    /**
     * index of the selected subtitle track (index in subtitle track lists)
     * @type {number}
     */
    get subtitleTrack(): number;
    /**
     * select an subtitle track, based on its index in subtitle track lists
     * @type {number}
     */
    set subtitleTrack(subtitleTrackId: number);
    /**
     * @type {boolean}
     */
    get subtitleDisplay(): boolean;
    /**
     * Enable/disable subtitle display rendering
     * @type {boolean}
     */
    set subtitleDisplay(value: boolean);
}
