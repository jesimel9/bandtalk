// Réglages enregistrés sur le téléphone (mêmes valeurs par défaut que l'appli Android,
// lib/services/settings_store.dart).
import { LS } from './backend.js';

const DEFAUTS = {
  listen: 1.0, // volume d'écoute global
  duck: 0.35, // volume restant des autres quand le chef parle
  voxDb: -24, // seuil d'ouverture du micro en mains libres
  noise: true, // anti-bruit du navigateur
  studio: false, // voix haute qualité (profil musique)
  countVoice: true, // décompte vocal « One, two, three, four, go »
  antiLarsen: true, // coupe le retour des autres quand je parle sur haut-parleur
  theme: 'auto', // auto | light | dark
};

export const settings = {
  ...DEFAUTS,
  load() {
    const saved = LS.json('bt_reglages', {});
    for (const k of Object.keys(DEFAUTS)) {
      if (k in saved && typeof saved[k] === typeof DEFAUTS[k]) this[k] = saved[k];
    }
  },
  save() {
    const out = {};
    for (const k of Object.keys(DEFAUTS)) out[k] = this[k];
    LS.set('bt_reglages', JSON.stringify(out));
  },
};
