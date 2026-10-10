// Вставьте сюда конфиг из Firebase Console:
// Project settings → General → Your apps → Web app → SDK setup and configuration → Config.
// Обязательно должен быть databaseURL (появляется после создания Realtime Database).
export const firebaseConfig = {
    apiKey: "AIzaSyAWCtrbwcP0RoUNERJRt_sBDzE5roOsUic",
    authDomain: "bunkeer-fb3f5.firebaseapp.com",
    databaseURL: "https://bunkeer-fb3f5-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "bunkeer-fb3f5",
    storageBucket: "bunkeer-fb3f5.firebasestorage.app",
    messagingSenderId: "648651610286",
    appId: "1:648651610286:web:a24f436666da99ad49753f"
  };

// Ключ сайта reCAPTCHA v3 для App Check (Site key, НЕ Secret key).
// Получить: https://www.google.com/recaptcha/admin → тип «Score based (v3)», домен hexareondev.github.io.
// Пустая строка — App Check выключен.
export const appCheckSiteKey = "6Ld8oegtAAAAANpjitUoAbo-JdL9t1UWSrm92Rqe";
