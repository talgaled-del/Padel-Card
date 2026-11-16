# כרטיס שחקן פאדל

אבטיפוס סטטי (HTML/CSS/JS) לכרטיס שחקן בעברית, מובייל-פרסט. שאלון קביעת רמה, תמונה, פרטנר קבוע מהמאגר, וקישור לשיתוף — כרטיס אישי או כרטיס זוג. שדות רשות: אזור, מגרשים קבועים, תדירות, ותק, סגנון וחוזקות. הדירוג בכרטיס מגיע רק מהשאלון (למשל B2 · 4.0). בעל הכרטיס יכול להעתיק את הקישור או לשתף אותו לוואטסאפ מהמכשיר שבו נוצר הכרטיס; מארגן שפותח כרטיס של מישהו אחר לא רואה את כפתורי השיתוף. במסך הכרטיס כפתור «בית» בראש המסך מחזיר לדף הבית.

## הרצה מקומית

```bash
python3 -m http.server 8765 --directory /workspace/padel-card-v15
```

פתיחה: http://127.0.0.1:8765/

הנתונים נשמרים ב-localStorage. כרטיס לשיתוף מקודד בכתובת (`#/p/...` ליחיד, `#/pair/...` לזוג). תמונות וסרטונים מועלים ל-Cloudinary (presets: `padel_card_photos`, `padel_card_videos`) והקישור המשותף שומר רק את כתובת הענן. כרטיסים ישנים עם תמונת data URL ממשיכים להופיע, ובעל הכרטיס רואה בקשה להעלות מחדש תמונה חדה לענן. אחרי העלאת סרטון, השחקן מסמן את עצמו ועיגול עוקב אחריו לאורך הסרטון. אם הזיהוי האוטומטי לא זמין אפשר ללחוץ ידנית על עצמכם בתמונה — ננסה לעקוב לפי הנקודה והצבע, ואם לא נוכל יישמר סימון "אני" בתחילת הסרטון (לא לכל אורך הסרטון).

לא לפרוס לציבור — זה אבטיפוס בלבד.

הנכסים הסטטיים נטענים מתיקייה `v15/` (למשל `v15/app.js`) כדי לעקוף את מטמון ה-CDN של Render, שמתעלם ממחרוזת `?v=N`. אחרי עדכון, מעתיקים את הקבצים לתיקיית גרסה חדשה ומעדכנים את `index.html`.

## סולם הרמות

D2 (2.0 מתחיל) · D1 (2.5) · C2 (3.0) · C1 (3.5) · B2 (4.0) · B1 (4.5) · A2 (5.0) · A1 (5.0+ עילית)

מקורות: [PadelSpot](https://padelspot.org/info/levels), [Circlo](https://circlo.co.il/blog/padel-levels-israel-guide), [PadelFuse](https://padelfuse.co.il/il/learn/eich-yodim-ma-harama/), [העמותה לקידום הפאדל](https://ilpa.co.il/%D7%90%D7%96-%D7%90%D7%99%D7%96%D7%95-%D7%A8%D7%9E%D7%94-%D7%90%D7%AA%D7%9D-%D7%91%D7%A4%D7%90%D7%93%D7%9C/).

## פריסה ציבורית (Render)

האתר הוא סטטי (HTML/CSS/JS). כדי לפרסם קישור חי ב-Render צריך מאגר Git ש-Render יכול לשכפל.

כרגע אין מאגר מתאים בחשבון GitHub (`talgaled-del`): המאגר היחיד הוא `comicst` (פרויקט אחר, לא לגעת),
ואין כלי שיוצר מאגר GitHub חדש מהסוכן. קריאה ל-`create_static_site` ב-Render נכשלה עם:

`400: repo is required when using service type: static_site`

### מה צריך לעשות
1. ב-GitHub, צרו מאגר ריק חדש (מומלץ ציבורי) בשם למשל `padel-card` תחת המשתמש `talgaled-del`.
2. שלחו את כתובת המאגר (למשל `https://github.com/talgaled-del/padel-card`).
3. נדחוף את הקבצים מ-`/workspace/padel-card-v15/` ונפרוס Static Site ב-Render לפי `render.yaml`
   (`buildCommand: true`, `staticPublishPath: ./`).

דמו אחרי הפריסה:
- כרטיס יחיד: `{URL}/#/demo/michal`
- כרטיס זוג: `{URL}/#/demo/pair`

## AI Rating (v12)

בעל הכרטיס לוחץ «קבל AI Rating» ליד הסרטונים. השרת (`server/`) מוריד את הסרטון מ-Cloudinary, שולח אותו ל-Gemini יחד עם תיאור השחקן המסומן (חצי המגרש, צד, מיקומים לאורך הסרטון וצבע בגדים), ומחזיר רמה בסולם האותיות, ביטחון, הסבר קצר וציוני משנה. התוצאה נשמרת בכרטיס ובקישור המשותף (`ai` ב-hash).

- `POST /api/ai-rating` — `{ videoUrl, track, cardId }` או `{ videos: [{ videoUrl, track | trackUrl, duration, appearance }], cardId, profile }`
- `GET /healthz`
- משתני סביבה: `GEMINI_API_KEY` (חובה), `GEMINI_MODEL` (ברירת מחדל `gemini-3.8-flash`), `ALLOWED_ORIGINS`, `MOCK_AI=1` לבדיקות, `RATE_PER_HOUR`/`RATE_PER_DAY`/`MAX_CONCURRENT`.
- הרצה מקומית במצב בדיקה: `cd server && MOCK_AI=1 EXTRA_VIDEO_HOSTS=127.0.0.1:18767 PORT=8787 node server.js`, ואז `node scripts/verify-v12.mjs`.
- קריאה אמיתית אחת מקובץ מקומי: `GEMINI_API_KEY=... node server/try-local.js video.mp4 track.json 30 black`.
- בצד הלקוח כתובת השרת מוגדרת ב-`AI_API` בראש `app.js` (`https://padel-card-api.onrender.com`; ב-localhost `http://127.0.0.1:8787`; אפשר לעקוף עם `localStorage["padelCard.apiBase"]`).

## v13

- **ניתוח לפי סרטון:** כל סרטון נשלח בבקשה נפרדת (`perVideo: true`), אחד אחרי השני, והתוצאה נשמרת על הסרטון (`v.ai`, ובקישור `a`) עם מפתח של הסרטון והסימון. סרטון שכבר נותח לא נשלח שוב; סימון מחדש מבטל רק אותו. תוצאה כללית מ-v12 משויכת לסרטונים הראשונים לפי מספר הסרטונים שנותחו אז.
- **שילוב דטרמיניסטי (בצד הלקוח):** משקל = שניות (מינימום 10) × ביטחון (1/2/3). רמה = ממוצע משוקלל של המיקום בסולם, מעוגל. ציוני משנה = ממוצע משוקלל מהסרטונים שבהם נצפו. ביטחון = ממוצע משוקלל, מוגבל לפי סך הזמן (פחות מ-2 דק׳ נמוך, פחות מ-5 דק׳ לכל היותר בינוני), ויורד דרגה אם יש פער של 3 רמות ומעלה בין הסרטונים. סרטון שנמחק יוצא מהחישוב.
- **פס התקדמות:** הערכה לפי זמן (2.7 שניות לכל שנייה של סרטון + 8 שניות), עד 95% עד שמגיעה תשובה, ושלב «מעיר את השרת…».
- **תג הרמה למעלה:** פער של רמה אחת בין השאלון ל-AI מוצג כטווח (למשל C1-B2). פער גדול יותר: נשאלים פעם אחת לכל צירוף רמות (`profile.lr`).
- **דף הבית:** «איך זה עובד». **סרטונים בכרטיס:** אזור מתקפל, סגור כברירת מחדל, זוכר את המצב בסשן.
- בדיקה: `node scripts/verify-v13.mjs` (שרת mock, ראו הערה בראש הקובץ).

## v14

v13 נשאר כמו שהוא (AI Rating לפי סרטון, פס התקדמות, תג טווח, «איך זה עובד», אזור סרטונים מתקפל), ובנוסף נוספה התחברות רשות עם Supabase.

- Google: `signInWithOAuth` עם `redirectTo` לכתובת האתר.
- אימייל: `signInWithOtp`, ואז 6 תיבות עם `autocomplete=one-time-code` והדבקה שממלאת את כולן. האימות הוא `verifyOtp` מסוג `email`.
- בלי התחברות האפליקציה עובדת כמו קודם (כרטיס במכשיר). מבקר שפותח קישור לא נדרש להתחבר.
- `config.js` כבר ממולא ב-Project URL (`https://ehcsbtbcelfoxfgraytl.supabase.co`) ובמפתח הציבורי `sb_publishable_…` (supabase-js 2.119.0 תומך בפורמט הזה). לא לשים כאן את מפתח ה-service role.
- הספרייה נטענת מ-CDN בגרסה קבועה: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0`
- בדיקה: `node scripts/verify-v14.mjs` (רגרסיית v13 מול שרת mock) ו-`node scripts/verify-v14-auth.mjs` (מסך התחברות + בקשת OTP אמיתית ל-Supabase).

### הגדרות שעדיין צריך ב-Supabase (אם לא הושלמו)

1. **Authentication → URL Configuration**
   - **Site URL:** `https://padel-card.onrender.com`
   - **Redirect URLs:** `https://padel-card.onrender.com`, `https://padel-card.onrender.com/**`, ולבדיקות מקומיות `http://127.0.0.1:8765` / `http://localhost:8765` (או הפורט שבו מריצים).
2. **Email OTP:** Authentication → Providers → Email — הספק מופעל. מומלץ לכבות Confirm email באבטיפוס. בתבנית המייל (Magic Link / OTP) חייב להופיע `{{ .Token }}`, לא רק קישור.
3. **Google:** ב-Google Cloud צרו OAuth client (Web application). Authorized JavaScript origins: `https://padel-card.onrender.com` ו-`http://127.0.0.1:8765`. Authorized redirect URI חייב להיות של Supabase: `https://ehcsbtbcelfoxfgraytl.supabase.co/auth/v1/callback`. ב-Supabase: Authentication → Providers → Google — הדביקו Client ID ו-Secret.

## v15

הכרטיס קשור לחשבון המחובר. אחרי התחברות (וגם בטעינה עם סשן קיים) נטען הכרטיס מטבלת `public.cards` ב-Supabase. אם אין עדיין שורה אבל יש כרטיס במכשיר (`padelCard.v2`), הוא מועלה אוטומטית לחשבון — כך הכרטיס שטל בנה עד כה עובר לחשבון כשיתחבר במכשיר שבו הוא שמור. כל שמירה (פרופיל, שאלון, סרטונים, AI, החלטת תג) מעדכנת את השורה בענן (עם השהייה קצרה). מזהה הכרטיס נשמר כדי שקישורי השיתוף הקיימים ימשיכו לעבוד.

- **צפייה ועריכה של הכרטיס שלי** רק אחרי התחברות. במסך הבית, בלי התחברות, מופיע מסך ההתחברות («התחברו כדי ליצור ולשמור את כרטיס השחקן שלכם»).
- **קישורי שיתוף** (`#/p/...`, `#/pair/...`, כרטיסי דוגמה) נשארים פתוחים לכולם בלי התחברות, כולל שתי שורות הדירוג.
- אם יש כרטיס בענן וכרטיס מקומי שונה, הענן גובר, והעותק המקומי נשמר ב-`padelCard.v2.backup`. התנתקות מחזירה למסך ההתחברות ולא מוחקת את הנתונים.
- הנכסים הסטטיים ב-`v15/`. בדיקות: `node scripts/verify-v15.mjs` (רגרסיית v13/v14 אחרי התחברות), `node scripts/verify-v15-auth.mjs` (שער התחברות + מבקר), `node scripts/verify-v15-sync.mjs` (סיבוב אמיתי מול Supabase עם משתמש בדיקה שנמחק בסוף).
