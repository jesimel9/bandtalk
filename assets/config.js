/* =====================================================================
   RÉGLAGES DU SITE BANDTALK — le seul fichier à modifier à chaque version.
   ===================================================================== */
window.BANDTALK = {
  // Version publiée et son fichier APK.
  version: '1.0.3',
  // Lien de téléchargement. Avec GitHub Releases, ce lien pointe TOUJOURS vers la
  // dernière version (si le fichier publié s'appelle toujours « BandTalk.apk ») :
  //   https://github.com/VOTRE-COMPTE/bandtalk/releases/latest/download/BandTalk.apk
  apkUrl: 'https://github.com/jesimel9/bandtalk/releases/latest/download/BandTalk.apk',
  apkSizeMo: 87,
  // Empreinte SHA-256 de l'APK (preuve que le fichier n'a pas été modifié). Vide = masquée.
  sha256: '7464603f20e39c09c5a408bf8ce7cbb392c90afe44876c5a1579ec9fe01070c7',
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
