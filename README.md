# כרטיס שחקן פאדל

אבטיפוס סטטי (HTML/CSS/JS) לכרטיס שחקן בעברית, מובייל-פרסט. שאלון קביעת רמה, תמונה, פרטנר קבוע מהמאגר, וקישור לשיתוף — כרטיס אישי או כרטיס זוג. שדות רשות: אזור, מגרשים קבועים, תדירות, ותק, סגנון ומכה חזקה. הדירוג בכרטיס מגיע רק מהשאלון (למשל B2 · 4.0). בעל הכרטיס יכול להעתיק את הקישור מהמכשיר שבו נוצר הכרטיס; מארגן שפותח כרטיס של מישהו אחר לא רואה כפתור העתקה.

## הרצה מקומית

```bash
python3 -m http.server 8765 --directory /workspace/padel-card
```

פתיחה: http://127.0.0.1:8765/

הנתונים נשמרים ב-localStorage. כרטיס לשיתוף מקודד בכתובת (`#/p/...` ליחיד, `#/pair/...` לזוג). תמונות נדחסות ל-data URL; בקישור המשותף הן נוסעות רק אם הן קטנות מספיק, אחרת מוצגות ראשי תיבות. סרטונים שהועלו נשארים מקומית; קישור חיצוני כן נוסע עם הכרטיס.

לא לפרוס לציבור — זה אבטיפוס בלבד.

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
3. נדחוף את הקבצים מ-`/workspace/padel-card/` ונפרוס Static Site ב-Render לפי `render.yaml`
   (`buildCommand: true`, `staticPublishPath: ./`).

דמו אחרי הפריסה:
- כרטיס יחיד: `{URL}/#/demo/michal`
- כרטיס זוג: `{URL}/#/demo/pair`
