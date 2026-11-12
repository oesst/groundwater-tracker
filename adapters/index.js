// Registry of all data-source adapters. Add a state here after writing its file.
import by from './by.js';   // Bayern       — live (GKD per-well pages)
import be from './be.js';   // Berlin       — live (Wasserportal CSV API)
import bw from './bw.js';   // Baden-Württ. — live (LUBW GuQ JSON API)
import nw from './nw.js';   // NRW          — live (OpenHygrisC open data, last-value/well)
import ni from './ni.js';   // Niedersachsen — live (NLWKN Grundwasserstand online REST/JSON)
import he from './he.js';   // Hessen       — live (HLNUG Messdatenportal JSON, DFÜ)
import hh from './hh.js';   // Hamburg       — live (BUKEA OGC API Features, daily)
import gruvo from './gruvo.js'; // national fill (BGR GRUVO, unwired states only)
import pending from './pending.js';

// Order: implemented/reliable first, then pending.
export const ADAPTERS = [by, be, bw, nw, ni, he, hh, gruvo, ...pending];
