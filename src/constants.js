// Constants — mirrors SpaceWar_constants.py.
// Frozen for the deployment config:
//   { speed: 5, ep_length: 4096, aug_obs: true, stochastic_hspace: true }

export const WRAP_BOUND          = Math.SQRT1_2;          // sqrt(0.5) ≈ 0.7071
export const NUM_MISSILES        = 32;
export const MISSILE_VEL         = 1 / 256;
export const MISSILE_LIFE        = 96;
export const MISSILE_RELOAD_TIME = 16;

export const SHIP_FUEL           = 1024;
export const SHIP_TURN_RATE      = (1 / 16) * 180 / Math.PI;        // ≈ 3.58°
export const SHIP_ACC            = (1 / 131072) * WRAP_BOUND * 2;   // ≈ 5.39e-6
export const GRAV_CONST          = 9.5e-7 * WRAP_BOUND * 2;         // ≈ 1.34e-6

export const DEFAULT_MAX_TIME    = 4096;
export const PLAYER_SIZE         = 0.02;
export const STAR_SIZE           = 0.01;

export const HYPERSPACE_CHARGES  = 8;
export const HYPERSPACE_RECHARGE = 224;
export const HYPERSPACE_REENTRY  = 96;
export const S_HSPACE_MAXSPEED   = (1 / 131072) * 256 * WRAP_BOUND * 2;

// MultiDiscrete order in SW_1v1_env.py: [thrust, turn, shoot, hyperspace].
export const ACTION_NVEC = [2, 3, 2, 2];

// Rendering — internal canvas resolution.  Display size is CSS-driven.
export const RENDER_DIM   = 750;
// Zoom: world [-WB, WB] fills the canvas instead of leaving a 30% black margin.
export const VIEW_SCALE   = 1 / WRAP_BOUND;
