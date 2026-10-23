// Un seul endroit à modifier si l'adresse de l'API ou une vidéo change.
// "/api" = passe par Vercel (voir vercel.json). Pour un test direct : "https://ton-domaine/api"
window.RANGERS = {
  API_URL: '/api',

  // Passe à true quand tes vidéos sont converties en MP4 H.264 (voir explications).
  // En attendant, le fond animé (lueurs + traînées de lumière) est utilisé partout.
  USE_VIDEOS: false,
  VIDEOS: {
    register: 'https://files.catbox.moe/1bgfke.mp4', // inscription (sans son)
    login:    'https://files.catbox.moe/obgv09.mp4', // connexion (sans son)
    inside:   'https://files.catbox.moe/k95byo.mp4'  // intérieur du site (bouton son)
  }
};
