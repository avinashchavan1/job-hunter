/** Source is missing setup (key, login, OAuth) — shown as a warning, run continues. */
export class SourceNotConfigured extends Error {}
/** Source hit a CAPTCHA / login wall / unusual-activity page — stop that source immediately and alert. */
export class StopSource extends Error {}
