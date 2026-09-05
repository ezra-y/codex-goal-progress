import { css } from "lit";

export const stateStyles = css`
    .state {
      position: relative;
      display: grid;
      min-height: calc(var(--gp-font-size) * 8);
      place-items: center;
      padding: calc(var(--gp-font-size) * 1.285714);
      text-align: center;
    }

    .phase-error .state {
      min-height: calc(var(--gp-font-size) * 10.857143);
    }

    .state-symbol {
      position: relative;
      display: grid;
      width: 30px;
      height: 30px;
      place-items: center;
      margin: 0 auto 12px;
      border: 1px solid var(--gp-line-strong);
      border-radius: 50%;
      color: var(--gp-muted);
      font-size: 13px;
      font-weight: 720;
    }

    .state-symbol.preparing {
      width: 22px;
      height: 22px;
      border: 2px solid color-mix(in srgb, var(--gp-icon-muted) 22%, transparent);
      border-top-color: var(--gp-accent);
      border-right-color: color-mix(in srgb, var(--gp-accent) 72%, var(--gp-icon-muted));
      background: transparent;
      box-shadow: none;
      animation: spin 1.1s linear infinite;
      backface-visibility: hidden;
      contain: strict;
      will-change: transform;
    }

    .state-symbol.preparing::after {
      content: none;
    }

    .state-symbol.error {
      border-color: color-mix(in srgb, var(--gp-blocked) 56%, transparent);
      color: var(--gp-blocked);
    }

    .state-title {
      color: var(--gp-text);
      font-size: max(10px, calc(var(--gp-font-size) - 2px));
      font-weight: 690;
      line-height: 1.35;
    }

    .state-copy {
      max-width: calc(var(--gp-font-size) * 25.714286);
      margin-top: calc(var(--gp-font-size) * 0.357143);
      color: var(--gp-muted);
      font-size: max(9px, calc(var(--gp-font-size) - 4px));
      line-height: 1.5;
    }

    .error-code {
      display: inline-block;
      margin-top: calc(var(--gp-font-size) * 0.571429);
      color: var(--gp-blocked);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: max(9px, calc(var(--gp-font-size) - 5px));
      overflow-wrap: anywhere;
    }

    .state-actions {
      display: flex;
      justify-content: center;
      gap: calc(var(--gp-font-size) * 0.285714);
      margin-top: calc(var(--gp-font-size) * 0.714286);
    }

    .sr-only {
      position: absolute;
      overflow: hidden;
      width: 1px;
      height: 1px;
      clip: rect(0, 0, 0, 0);
      clip-path: inset(50%);
      white-space: nowrap;
    }

`;
