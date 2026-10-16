/* =====================================================================
   RÉGLAGES DU SITE BANDTALK — le seul fichier à modifier à chaque version.
   ===================================================================== */
window.BANDTALK = {
  // Version publiée et son fichier APK.
  version: '1.0.6',
  // Lien de téléchargement. Avec GitHub Releases, ce lien pointe TOUJOURS vers la
  // dernière version (si le fichier publié s'appelle toujours « BandTalk.apk ») :
  //   https://github.com/VOTRE-COMPTE/bandtalk/releases/latest/download/BandTalk.apk
  apkUrl: 'https://github.com/jesimel9/bandtalk/releases/latest/download/BandTalk.apk',
  apkSizeMo: 86,
  // Empreinte SHA-256 de l'APK (preuve que le fichier n'a pas été modifié). Vide = masquée.
  sha256: '116e25d6102a3fe765249caaadb26ebaf946a0951f8139f4d28ba51e6924c895',
  androidMin: 'Android 7',

  // Abonnement (doit correspondre à la table « reglages » de la base de données).
  prixFcfa: 2000,
  dureeJours: 30,
  essaisGratuits: 2,
  numeroWave: '+2250797361516',
  // Promotion : prixFcfa (ci-dessus) est le prix promo jusqu'à promoFin, puis le site
  // affiche tout seul prixNormalFcfa. ⚠️ Le prix réellement payé vient de la base :
  // le 1er janvier, mettez aussi « prix_fcfa » à 5000 dans Supabase › reglages.
  prixNormalFcfa: 5000,
  promoFin: '2026-12-31T23:59:59Z', // dernière seconde de la promo (heure d'Abidjan = UTC)

  // Version iPhone (web-app jesimel9.github.io/bandtalk/app).
  //   false : tout ce qui concerne l'iPhone est caché, le site annonce « Bientôt disponible »
  //           avec un compte à rebours jusqu'à iosDate ;
  //   true  : le site montre l'installation sur iPhone (bouton, tutoriel, QR code, FAQ).
  iosDisponible: false,
  iosDate: '2027-01-16T10:00:00Z', // date de lancement prévue (heure d'Abidjan = UTC)

  // Contact affiché sur le site. Vide = ligne masquée.
  contactEmail: '',      // ex. 'contact@bandtalk.ci'
  contactWhatsapp: '+2250797361516',
};
