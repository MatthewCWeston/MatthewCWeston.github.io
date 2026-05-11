import {
  NUM_MISSILES, MISSILE_RELOAD_TIME, SHIP_FUEL,
  HYPERSPACE_CHARGES, HYPERSPACE_RECHARGE, HYPERSPACE_REENTRY,
} from './constants.js';

/**
 * Builds & updates the two HUD panels that sit in the bottom-left (P0/orange)
 * and top-right (P1/cyan) corners of the stage, matching the ship spawns.
 *
 *   ammo   → row of NUM_MISSILES triangle icons; spent ones go dim
 *   reload → thin progress bar (only visible while reloading)
 *   fuel   → wide bar
 *   warp   → row of HYPERSPACE_CHARGES diamond icons; charges that
 *            have been spent go hollow, with the active recharge
 *            outlined and partially filled
 */
export class HUD {
  /**
   * @param {HTMLElement} hudP1Root  - corner div for player 0 (orange, lower-left)
   * @param {HTMLElement} hudP2Root  - corner div for player 1 (cyan, upper-right)
   */
  constructor(hudP1Root, hudP2Root) {
    this.panels = [
      this._buildPanel(hudP1Root, 'P1', 'ORANGE'),
      this._buildPanel(hudP2Root, 'P2', 'CYAN'),
    ];
  }

  _buildPanel(root, name, accent) {
    root.innerHTML = '';
    root.classList.add('hud');
    const tag = document.createElement('div');
    tag.className = 'hud-tag';
    tag.textContent = `${name} // ${accent}`;
    root.appendChild(tag);

    // Ammo: NUM_MISSILES triangle icons.
    const ammoRow = document.createElement('div');
    ammoRow.className = 'hud-icons hud-ammo';
    const ammoIcons = [];
    for (let i = 0; i < NUM_MISSILES; i++) {
      const icon = document.createElement('span');
      icon.className = 'hud-tri';
      ammoRow.appendChild(icon);
      ammoIcons.push(icon);
    }
    root.appendChild(ammoRow);

    // Thin reload progress bar (visible only when reloading).
    const reloadBar = document.createElement('div');
    reloadBar.className = 'hud-bar hud-bar-thin';
    const reloadFill = document.createElement('div');
    reloadFill.className = 'hud-bar-fill';
    reloadBar.appendChild(reloadFill);
    root.appendChild(reloadBar);

    // Fuel: bar + label.
    const fuelRow = document.createElement('div');
    fuelRow.className = 'hud-row';
    const fuelLabel = document.createElement('span');
    fuelLabel.className = 'hud-label';
    fuelLabel.textContent = 'FUEL';
    const fuelBar = document.createElement('div');
    fuelBar.className = 'hud-bar';
    const fuelFill = document.createElement('div');
    fuelFill.className = 'hud-bar-fill';
    fuelBar.appendChild(fuelFill);
    fuelRow.appendChild(fuelLabel);
    fuelRow.appendChild(fuelBar);
    root.appendChild(fuelRow);

    // Warp: 8 diamonds + thin recharge bar.
    const warpRow = document.createElement('div');
    warpRow.className = 'hud-row';
    const warpLabel = document.createElement('span');
    warpLabel.className = 'hud-label';
    warpLabel.textContent = 'WARP';
    const warpIcons = [];
    const warpIconRow = document.createElement('div');
    warpIconRow.className = 'hud-icons';
    for (let i = 0; i < HYPERSPACE_CHARGES; i++) {
      const dia = document.createElement('span');
      dia.className = 'hud-dia';
      warpIconRow.appendChild(dia);
      warpIcons.push(dia);
    }
    warpRow.appendChild(warpLabel);
    warpRow.appendChild(warpIconRow);
    root.appendChild(warpRow);

    return { ammoIcons, reloadBar, reloadFill, fuelFill, warpIcons };
  }

  /** Update both panels from the current env state. */
  update(env) {
    for (let i = 0; i < 2; i++) this._updatePanel(this.panels[i], env.playerShips[i]);
  }

  _updatePanel(panel, ship) {
    // Ammo icons: bright if available, dim if spent.
    for (let i = 0; i < NUM_MISSILES; i++) {
      panel.ammoIcons[i].classList.toggle('spent', i >= ship.stored_missiles);
    }
    // Reload bar: visible when reloading.
    if (ship.reloadTime > 0) {
      panel.reloadBar.classList.add('visible');
      panel.reloadFill.style.transform =
        `scaleX(${ship.reloadTime / MISSILE_RELOAD_TIME})`;
    } else {
      panel.reloadBar.classList.remove('visible');
    }
    // Fuel bar.
    panel.fuelFill.style.transform = `scaleX(${ship.fuel / SHIP_FUEL})`;
    // Warp icons.
    //   - charges remaining → solid filled diamonds (count = ship.h_charges).
    //   - while recharging → the next-to-spend slot (the rightmost remaining
    //     charge) shows partial fill; in-hyperspace gets the dashed border.
    //   - spent → hollow.
    const recharging   = ship.h_reload > 0;
    const rechargeFrac = recharging ? 1 - ship.h_reload / HYPERSPACE_RECHARGE : 0;
    const primingIdx   = (recharging && ship.h_charges > 0) ? ship.h_charges - 1 : -1;
    for (let i = 0; i < HYPERSPACE_CHARGES; i++) {
      const icon = panel.warpIcons[i];
      icon.classList.remove('full', 'partial', 'empty', 'in-flight');
      if (i === primingIdx) {
        icon.classList.add('partial');
        if (ship.h_reload > HYPERSPACE_RECHARGE - HYPERSPACE_REENTRY) {
          icon.classList.add('in-flight');         // ship is OUT in hyperspace
        }
        icon.style.setProperty('--frac', rechargeFrac.toFixed(3));
      } else if (i < ship.h_charges) {
        icon.classList.add('full');
      } else {
        icon.classList.add('empty');
      }
    }
  }
}
