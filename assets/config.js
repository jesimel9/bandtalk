/* =====================================================================
   RÉGLAGES DU SITE BANDTALK — le seul fichier à modifier à chaque version.
   ===================================================================== */
window.BANDTALK = {
  // Version publiée et son fichier APK.
  version: '1.0.4',
  // Lien de téléchargement. Avec GitHub Releases, ce lien pointe TOUJOURS vers la
  // dernière version (si le fichier publié s'appelle toujours « BandTalk.apk ») :
  //   https://github.com/VOTRE-COMPTE/bandtalk/releases/latest/download/BandTalk.apk
  apkUrl: 'https://github.com/jesimel9/bandtalk/releases/latest/download/BandTalk.apk',
  apkSizeMo: 86,
  // Empreinte SHA-256 de l'APK (preuve que le fichier n'a pas été modifié). Vide = masquée.
  sha256: 'b2a08787c9ec9617ca725748fb8d4b55a84fd1c05d80d8e24eafbbf07bb587a7',
  androidMin: 'Android 7',

  // Abonnement (doit correspondre à la table « reglages » de la base de données).
  prixFcfa: 2000,
  dureeJours: 30,
  essaisGratuits: 2,
  numeroWave: '+2250797361516',

  // Contact affiché sur le site. Vide = ligne masquée.
  contactEmail: '',      // ex. 'contact@bandtalk.ci'
  contactWhatsapp: '+2250797361516',
};
