/* =====================================================================
   RÉGLAGES DU SITE BANDTALK — à modifier à chaque nouvelle version de l'APK.

   Les informations marquées (*) se modifient SANS toucher à ce fichier, dans
   l'appli : Administration › Réglages › Site web (et › Réglages pour le prix,
   la durée, les essais et le numéro Wave). Le site les lit dans la base à chaque
   ouverture ; les valeurs ci-dessous ne servent que si la base ne répond pas.
   ===================================================================== */
window.BANDTALK = {
  // Version publiée et son fichier APK.
  version: '1.0.8',
  // Lien de téléchargement. Avec GitHub Releases, ce lien pointe TOUJOURS vers la
  // dernière version (si le fichier publié s'appelle toujours « BandTalk.apk ») :
  //   https://github.com/VOTRE-COMPTE/bandtalk/releases/latest/download/BandTalk.apk
  apkUrl: 'https://github.com/jesimel9/bandtalk/releases/latest/download/BandTalk.apk',
  apkSizeMo: 87,
  // Empreinte SHA-256 de l'APK (preuve que le fichier n'a pas été modifié). Vide = masquée.
  sha256: 'ac2ab248fe095dd613c1ccc00d2edfc141723a9379bcbf0a1229b1c2efc5f3cb',
  androidMin: 'Android 7',

  // Base de données où le site lit les informations (*). Clé PUBLIQUE, lecture seule.
  supabaseUrl: 'https://uoarafoznwtoxjkftngf.supabase.co',
  supabaseKey: 'sb_publishable_FYQsUUsnaQZ2ArtudLsQUg_pb5rHeS6',

  // Abonnement (*) — le prix réellement payé est celui de la base.
  prixFcfa: 2000,
  dureeJours: 30,
  essaisGratuits: 5,
  numeroWave: '+2250797361516',
  // Promotion (*) : prixFcfa est le prix promo jusqu'à promoFin, puis le site affiche tout
  // seul prixNormalFcfa. ⚠️ Le 1er janvier, mettez aussi le prix de l'abonnement à 5000
  // dans l'appli (Administration › Réglages).
  promoTitre: 'Promo de fin d’année',
  prixNormalFcfa: 5000,
  promoFin: '2026-12-31T23:59:59Z', // dernière seconde de la promo (heure d'Abidjan = UTC)

  // Textes (*) : vide = texte d'origine de la page / pas d'annonce.
  annonce: '',
  titre: '',
  accroche: '',

  // Bouton « Acheter BandTalk PRO » (*) : boutique en ligne. Vide = bouton masqué.
  lienAchat: 'https://vkxiqkax.mychariow.shop/prd_7ntyvz8a',

  // Version iPhone (web-app jesimel9.github.io/bandtalk/app).
  //   false : tout ce qui concerne l'iPhone est caché, le site annonce « Bientôt disponible »
  //           avec un compte à rebours jusqu'à iosDate ;
  //   true  : le site montre l'installation sur iPhone (bouton, tutoriel, QR code, FAQ).
  iosDisponible: false,
  iosDate: '2027-01-16T10:00:00Z', // date de lancement prévue (heure d'Abidjan = UTC)

  // Contact affiché sur le site (*). Vide = ligne masquée.
  contactEmail: '',      // ex. 'contact@bandtalk.ci'
  contactWhatsapp: '+2250797361516',
};
