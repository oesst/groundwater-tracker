// Registry of all data-source adapters. Add a state here after writing its file.
import by from './by.js';   // Bayern       — live (GKD per-well pages)
import be from './be.js';   // Berlin       — live (Wasserportal CSV API)
import bw from './bw.js';   // Baden-Württ. — scaffold (LUBW/UDO)
import nw from './nw.js';   // NRW          — scaffold (ELWAS/LANUV)
import ni from './ni.js';   // Niedersachs. — scaffold (NLWKN)
import pending from './pending.js';

// Order: implemented/reliable first, then pending.
export const ADAPTERS = [by, be, bw, nw, ni, ...pending];
