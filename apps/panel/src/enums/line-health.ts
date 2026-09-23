export enum LineHealth {
  Up = 'up',
  Down = 'down',
  Connecting = 'connecting',
  Unconfigured = 'unconfigured',
  Missing = 'missing',
  Disabled = 'disabled',
  /** The gateway could not be read, so this line's connection state is not known. */
  Unknown = 'unknown',
}
