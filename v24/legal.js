/* Padel Card — legal pages, login consent, and media-rights consent. */
(function () {
  var VERSION = "2026-11-16";
  var INTENT_KEY = "padelCard.legalIntent";
  var hooks = {
    go: function () {},
    showToast: function () {}
  };
  var cache = { loaded: false, accepted: false, version: "", media: false, userId: null };

  function $(id) { return document.getElementById(id); }

  function client() {
    return window.PadelAuth && typeof PadelAuth.getClient === "function" ? PadelAuth.getClient() : null;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var PAGES = {
    terms: {
      title: "תנאי שימוש",
      kicker: "Padel Card",
      html: [
        "<p>ברוכים הבאים ל־Padel Card («השירות»), כרטיס שחקן לפאדל שנועד לשיתוף בקבוצות וואטסאפ ובמפגשים בין שחקנים. השירות מופעל על ידי טל גלעד («אנחנו», «המפעיל») באמצעות האתר <span dir=\"ltr\">padelcard.app</span>.</p>",
        "<p>השימוש בשירות כפוף לתנאים אלה. יצירת חשבון, התחברות או שימוש בכרטיס מהווים הסכמה לתנאים. אם אינכם מסכימים, אין להשתמש בשירות.</p>",

        "<h2>השירות</h2>",
        "<p>השירות מאפשר ליצור כרטיס שחקן אישי: שאלון רמה, פרטים אישיים, תמונה, סרטוני משחק, דירוג AI וקישור לשיתוף. אם יש פרטנר קבוע, אפשר לשתף גם כרטיס זוגי. השירות נועד להציג אתכם למארגני משחק ולשחקנים אחרים, ואינו פלטפורמת היכרויות או הזמנת מגרשים.</p>",
        "<p>השירות ניתן כיום בחינם, ללא תשלום מצד המשתמשים. אין באתר רכישות, מנויים או חיובים. ייתכן שבעתיד יוצגו בשירות תכנים ממומנים או יופיעו נותני חסות. אם וכאשר זה יקרה, נעדכן את התנאים האלה ונודיע על השינוי לפני כניסתו לתוקף.</p>",

        "<h2>כשירות וקטינים</h2>",
        "<p>השירות מיועד למשתמשים בני 16 ומעלה. מי שטרם מלאו לו 16 רשאי להשתמש בשירות רק בהסכמת הורה או אפוטרופוס, ובהתאם לכך שההורה או האפוטרופוס קרא את התנאים ואת מדיניות הפרטיות ומסכים להם. אם נדע שחשבון נוצר בניגוד לכלל זה, נוכל להשעות או למחוק אותו.</p>",

        "<h2>חשבון והתחברות</h2>",
        "<p>כדי ליצור כרטיס ולשמור אותו יש להתחבר בחשבון, באמצעות Google או באמצעות קוד חד־פעמי שנשלח לאימייל. אתם אחראים לשמור על גישה לחשבון ולכתובת האימייל הרשומה, ולא להעביר את החשבון לאחר. יש למסור פרטים נכונים, ולעדכן אותם אם הם משתנים.</p>",
        "<p>אפשר להתנתק בכל עת. ניתוק אינו מוחק את הכרטיס השמור בחשבון. מחיקת החשבון תתבצע לפי המפורט במדיניות הפרטיות.</p>",

        "<h2>תוכן שהמשתמש מעלה</h2>",
        "<p>אתם יכולים להעלות לשירות שם, פרטי שחקן, תמונת פרופיל וסרטוני משחק («התוכן שלכם»). אתם מצהירים ומתחייבים כי:</p>",
        "<ul><li>התוכן שייך לכם, או שיש לכם את כל הזכויות וההרשאות הנדרשות כדי להעלות אותו ולשתף אותו בשירות;</li><li>התוכן אינו מפר זכויות יוצרים, סימני מסחר, פרטיות או זכות אחרת של צד שלישי;</li><li>כל אדם שמופיע בסרטונים או בתמונות הסכים להופעתו בתוכן ולשיתופו באמצעות השירות, ובמקרה של קטין — ניתנה הסכמת הורה או אפוטרופוס.</li></ul>",
        "<p>אתם נשארים בעלי הזכויות בתוכן שלכם. כדי שנפעיל את השירות, אתם מעניקים לנו רישיון מוגבל, עולמי, שאינו בלעדי, נטול תמלוגים, להעלאה, אחסון, עיבוד (לרבות ניתוח AI של סרטונים, לפי בחירתכם) והצגה של התוכן לכל מי שמחזיק בקישור השיתוף או צופה בכרטיס במסגרת השירות. הרישיון נמשך כל עוד התוכן שמור בחשבון, ומסתיים כשהתוכן או החשבון נמחקים, בכפוף לגבויים טכניים לזמן מוגבל ולחובות חוקיות.</p>",

        "<h2>קישורי שיתוף</h2>",
        "<p>קישור לכרטיס או לכרטיס זוגי הוא קישור ציבורי. כל מי שמחזיק בקישור יכול לצפות בכרטיס, בלי להתחבר, כל עוד הכרטיס פעיל והקישור תקין. אין לנו שליטה על הפצה של הקישור על ידיכם או על ידי מי שקיבל אותו. מומלץ לשתף את הקישור רק עם מי שאתם מעוניינים שיראה את הכרטיס.</p>",

        "<h2>דירוג AI ורמת השאלון</h2>",
        "<p>רמת השאלון («רמה לפי השאלון») ודירוג ה־AI («AI Rating») הם הערכות בלבד. הן אינן דירוג רשמי, אינן מחייבות, ואינן מהוות ייעוץ מקצועי או התחייבות לרמה במשחק. לשירות אין קשר, אישור או שותפות עם כל התאחדות, איגוד, מועדון או פלטפורמה, לרבות Playtomic או כל גוף רשמי אחר, אלא אם צוין במפורש אחרת.</p>",
        "<p>הדירוגים מוצגים כפי שהם, בלי אחריות לדיוק, להתאמה או לתוצאה. אפשר שמקור הנתונים, המודל או שיטת החישוב ישתנו מעת לעת.</p>",
        "<p>דירוג מוסמך («דירוג כוכב») הוא חוות דעת מקצועית של מאמן או מומחה פאדל שאושר כמוסמך בשירות. הוא אינו דירוג רשמי, אינו מחייב, ואינו מהווה אישור של התאחדות, איגוד, מועדון או גוף רשמי אחר.</p>",

        "<h2>שימוש אסור</h2>",
        "<p>אסור להשתמש בשירות באופן בלתי חוקי או הפוגע באחרים, ובכלל זה: להתחזות לאחר; להעלות תוכן מטעה, פוגעני, אלים או בעל אופי מיני; להפר זכויות של אחרים; לשלוח תוכנות זדוניות; לנסות לפרוץ לשירות, לעקוף הגבלות או לגשת לחשבון שאינו שלכם; לאסוף מידע על משתמשים אחרים בלי הרשאה; או להשתמש בשירות באופן הפוגע בתפעולו.</p>",

        "<h2>סמכויות ניהול</h2>",
        "<p>אנו רשאים, לפי שיקול דעתנו ובכפוף לדין, להשעות או לבטל חשבון, להסתיר כרטיס או למחוק תוכן, אם סברנו שהופרו התנאים, שיש סיכון למשתמשים או לשירות, או שיש חובה חוקית לעשות כן. חשבון שהושבת לא יוכל להתחבר, וקישורי השיתוף שלו יוצגו כלא זמינים.</p>",

        "<h2>העדר אחריות והגבלת אחריות</h2>",
        "<p>השירות ניתן «כפי שהוא» ו«כפי שזמין». איננו מתחייבים שהשירות יהיה רציף, חף משגיאות או מתאים למטרה מסוימת, ושנתונים לא יאבדו. משחק פאדל הוא פעילות ספורטיבית הכרוכה בסיכון. ההחלטה לשחק, עם מי לשחק ואיך להתכונן היא באחריותכם בלבד. שידוך או תיאום משחק בין משתמשים, לרבות בעקבות כרטיס שנשלח בקבוצה, הם באחריות המשתמשים עצמם. איננו צד למפגש, איננו בודקים את זהות המשתמשים מעבר להתחברות, ואיננו אחראים להתנהגות של משתמשים אחרים.</p>",
        "<p>במידה המרבית שמותרת לפי הדין, לא נהיה אחראים לנזק עקיף, תוצאתי, מיוחד או אובדן רווח, נתונים או הזדמנות, הנובע מהשימוש בשירות או מאי־יכולת להשתמש בו. חלק מההגבלות האלה עשויות שלא לחול במקרים שבהם הדין אוסר על הגבלה, למשל במקרה של זדון או רשלנות חמורה.</p>",

        "<h2>שינוי התנאים</h2>",
        "<p>אנו רשאים לעדכן את התנאים מעת לעת, לרבות אם יתווספו תכנים ממומנים או נותני חסות. נוסח מעודכן יפורסם בשירות עם תאריך תחולה, ובמקרה של שינוי מהותי נבקש הסכמה מחודשת או נודיע באופן בולט. המשך שימוש אחרי כניסת השינוי לתוקף, או אישור מפורש, יהווה הסכמה לנוסח המעודכן.</p>",

        "<h2>דין וסמכות שיפוט</h2>",
        "<p>על התנאים האלה ועל השימוש בשירות יחול דין מדינת ישראל, והסמכות הייחודית נתונה לבתי המשפט המוסמכים בתל אביב־יפו, בכפוף לזכויות שאינן ניתנות להתניה לפי דין.</p>",

        "<h2>יצירת קשר</h2>",
        "<p>לשאלות, בקשות או הודעות בנוגע לתנאים אלה: <a href=\"mailto:support@padelcard.app\" dir=\"ltr\">support@padelcard.app</a>.</p>"
      ].join("\n")
    },
    privacy: {
      title: "מדיניות פרטיות",
      kicker: "Padel Card",
      html: [
        "<p>מדיניות זו מסבירה איך Padel Card («השירות», «אנחנו») אוסף, משתמש ושומר מידע אישי. המדיניות נוסחה בהתאם לחוק הגנת הפרטיות, התשמ״א–1981, לרבות תיקון מס׳ 13 שנכנס לתוקף באוגוסט 2025, ובאופן שמתחשב גם בעקרונות מקובלים של הגנת מידע באירופה (GDPR) ככל שהם רלוונטיים.</p>",
        "<p>המפעיל הוא טל גלעד, ישראל. פניות: <a href=\"mailto:support@padelcard.app\" dir=\"ltr\">support@padelcard.app</a>.</p>",

        "<h2>איזה מידע נאסף</h2>",
        "<ul><li><strong>חשבון והתחברות:</strong> כתובת אימייל, מועד ההרשמה, מועד הכניסה האחרונה, וספק ההתחברות (Google או אימייל). אם מתחברים עם Google, עשויים להתקבל גם שם ותמונת פרופיל שגוגל מעביר לפי הרשאותיכם.</li><li><strong>פרטי הכרטיס:</strong> שם התצוגה, גיל, מין, יד חזקה, צד מועדף, אזור, מגרשים, ותק, סגנון משחק, תשובות לשאלון הרמה, פרטנר קבוע אם ציינתם, וכל שדה אחר שמילאתם בכרטיס.</li><li><strong>מדיה:</strong> תמונת פרופיל וסרטוני משחק שאתם מעלים, וסימונים שאתם מוסיפים בסרטון.</li><li><strong>דירוג מוסמך:</strong> אם מוסמך דירג את הכרטיס, נשמרים הרמה, הערה אופציונלית, שם המוסמך ומועד הדירוג, והם מוצגים בכרטיס הציבורי.</li><li><strong>הסכמות:</strong> גרסת התנאים ומדיניות הפרטיות שאישרתם, מועד האישור, ואישור זכויות במדיה אם ניתן.</li><li><strong>מידע טכני:</strong> נתונים שרכיבי האחסון, האחסון בענן והשרתים אוספים לצורך תפעול ואבטחה, כגון כתובת IP, סוג דפדפן, מזהה מכשיר חלקי ויומני שגיאה. אין לנו מערכת פרסום שמנתחת את המידע הזה לצורך מעקב פרסומי.</li></ul>",

        "<h2>מטרות השימוש</h2>",
        "<p>אנו משתמשים במידע כדי לספק את השירות ולתפעל אותו: יצירת חשבון והתחברות, שמירת הכרטיס, הצגתו למי שמחזיק בקישור, ניתוח סרטונים לפי בקשתכם, אבטחה, מניעת שימוש לרעה, תמיכה, עמידה בחובות חוקיות, ושיפור השירות. הבסיס העיקרי הוא ביצוע ההסכם איתכם (תנאי השימוש) והסכמה בנוגע לתוכן שאתם מעלים ולניתוח AI.</p>",

        "<h2>עיבוד סרטונים ב־AI</h2>",
        "<p>אם ביקשתם «AI Rating», הסרטונים (או קבצים שנגזרים מהם) נשלחים לניתוח אצל ספק בינה מלאכותית — כיום Google Gemini — כדי להעריך רמה וסגנון משחק. הניתוח מתבצע לפי בקשתכם בלבד. תוצאת הניתוח נשמרת בכרטיס שלכם.</p>",

        "<h2>מעבדים וצדדים שלישיים</h2>",
        "<p>כדי להפעיל את השירות אנו נעזרים בספקים אלה. הם מעבדים מידע רק לצורך מתן השירות, לפי התקשרות איתם:</p>",
        "<ul><li><strong>Supabase</strong> — אימות, בסיס נתונים ואחסון רשומות החשבון והכרטיס;</li><li><strong>Render</strong> — אירוח אתר השירות ושרת ה־API;</li><li><strong>Resend</strong> — משלוח קוד התחברות לאימייל;</li><li><strong>Google</strong> — התחברות ב־OAuth, וניתוח סרטונים באמצעות Gemini;</li><li><strong>Cloudinary</strong> — אחסון והצגה של תמונות וסרטונים.</li></ul>",
        "<p>ספקים אלה עשויים לשמור או לעבד מידע מחוץ לישראל, לרבות באיחוד האירופי, בבריטניה או בארצות הברית. כאשר מידע מועבר מחוץ לישראל, אנו עושים זאת לצורך תפעול השירות ובהתאם לדין, תוך התקשרות עם ספקים מוכרים שיש להם התחייבויות הגנה על מידע.</p>",

        "<h2>שמירת מידע</h2>",
        "<p>מידע החשבון והכרטיס נשמר כל עוד החשבון פעיל. אם החשבון או הכרטיס נמחקים, נשתדל למחוק או להפוך לבלתי־מזהה את המידע בתוך זמן סביר, למעט מידע שעלינו לשמור לפי דין (למשל תיעוד של פעולת מחיקה או מחלוקת), או עותקי גיבוי טכניים לתקופה מוגבלת. ספקים חיצוניים עשויים לשמור עותקים לפי מדיניות הגיבוי שלהם לזמן קצר.</p>",

        "<h2>הזכויות שלכם</h2>",
        "<p>בכפוף לדין, יש לכם זכות לעיין במידע האישי שלכם, לבקש לתקן אותו אם הוא שגוי, למחוק אותו, ולהתנגד או להגביל עיבוד מסוים במקרים המתאימים. אפשר לעדכן את פרטי הכרטיס בחשבון עצמו. למחיקת החשבון והתוכן אפשר לפנות אלינו בכתובת <a href=\"mailto:support@padelcard.app\" dir=\"ltr\">support@padelcard.app</a> מכתובת האימייל של החשבון, או להשתמש באפשרות המחיקה אם היא מוצעת בחשבון. נשיב בתוך הזמנים הקבועים בחוק, ובמקרה הצורך נבקש לזהות את המבקש כדי להגן על חשבונות אחרים.</p>",

        "<h2>עוגיות ו־localStorage</h2>",
        "<p>השירות משתמש ב־localStorage ובאחסון מקומי דומה כדי לשמור את הכרטיס במכשיר, את מצב ההתחברות ואת הסכמתכם לתנאים. אלה אינם עוגיות פרסום, ואיננו משתמשים כיום במעקב פרסומי, במזהי פרסום או בכלים של רשתות מודעות.</p>",
        "<p>ייתכן שבעתיד יוצגו תכנים ממומנים או יופיעו נותני חסות. אם וכאשר נשתמש בכלים לצורך מדידה, הצגת תוכן ממומן או מעקב שכזה, נעדכן את מדיניות הפרטיות וניתן הודעה כנדרש לפי דין לפני שהשינוי ייכנס לתוקף, ובמידת הצורך נבקש הסכמה.</p>",

        "<h2>אבטחה</h2>",
        "<p>אנו נוקטים אמצעים סבירים להגנה על המידע, לרבות הצפנת תעבורה, הגבלת גישה והרשאות בצד השרת. אין אבטחה מושלמת, ואנו לא יכולים להבטיח שלא יתרחש אירוע אבטחה. אם יתגלה אירוע שיש חובה לדווח עליו, נפעל לפי הדין.</p>",

        "<h2>קטינים</h2>",
        "<p>השירות מיועד לבני 16 ומעלה, או למי שטרם מלאו לו 16 בהסכמת הורה או אפוטרופוס. איננו אוספים במודע מידע מילדים מתחת לגיל זה בלי הסכמה כזו. אם אתם סבורים שנאסף מידע כזה, פנו אלינו ונמחק אותו.</p>",

        "<h2>שינויים במדיניות</h2>",
        "<p>אפשר שנעדכן מדיניות זו מעת לעת. נוסח מעודכן יפורסם בשירות עם תאריך התחולה. בשינוי מהותי, לרבות אם יתווסף שימוש פרסומי או מדידה עבור נותני חסות, נודיע או נבקש הסכמה כנדרש.</p>",

        "<h2>יצירת קשר</h2>",
        "<p>למימוש זכויות, שאלות או בקשות: <a href=\"mailto:support@padelcard.app\" dir=\"ltr\">support@padelcard.app</a>.</p>"
      ].join("\n")
    },
    copyright: {
      title: "זכויות יוצרים וקניין רוחני",
      kicker: "Padel Card",
      html: [
        "<p>© Padel Card / <span dir=\"ltr\">padelcard.app</span> / טל גלעד. כל הזכויות שמורות.</p>",

        "<h2>השירות עצמו</h2>",
        "<p>עיצוב האתר והכרטיס, הקוד, הלוגו, סימן ה־P, מערכת הרמות והשאלון, וכל חומר מקורי אחר של השירות, הם קניינם של המפעיל או של מי שהרשה את השימוש בהם. אין להעתיק, לשכפל, לעבד, להפיץ או להשתמש בהם למטרות מסחריות בלי הרשאה מראש ובכתב, למעט שימוש סביר לצורך צפייה בשירות עצמו או שיתוף הכרטיס האישי באמצעות הקישור שהשירות מפיק.</p>",

        "<h2>התוכן של המשתמשים</h2>",
        "<p>התמונות, הסרטונים, השם ופרטי הכרטיס שאתם מעלים נשארים בבעלותכם או בבעלות בעל הזכויות בהם. אתם מעניקים לשירות רישיון מוגבל להצגה ולאחסון, כמפורט בתנאי השימוש. אין בכך העברת בעלות אלינו.</p>",
        "<p>משתמשים אחרים ומי שמחזיק בקישור שיתוף רשאים לצפות בכרטיס, אך אין להם רשות להעתיק או להשתמש בתוכן שלכם מחוץ להקשר סביר של תיאום משחק, בלי הסכמתכם.</p>",

        "<h2>דיווח על הפרה וטיפול בתוכן</h2>",
        "<p>אם אתם סבורים שתוכן בשירות מפר זכות יוצרים או קניין רוחני שלכם, פנו אלינו בכתובת <a href=\"mailto:support@padelcard.app\" dir=\"ltr\">support@padelcard.app</a> והוסיפו, ככל האפשר:</p>",
        "<ul><li>שמכם ופרטי קשר;</li><li>תיאור היצירה או הזכות שנפגעה;</li><li>קישור או תיאור מדויק של התוכן הפוגע בשירות;</li><li>הצהרה בתום לב שהשימוש אינו מורשה על ידי בעל הזכות, סוכנו או הדין;</li><li>הצהרה שהמידע בפנייה נכון, ושתכם הוא בעל הזכות או מורשה לפעול בשמו.</li></ul>",
        "<p>לאחר קבלת פנייה מפורטת נבחן אותה בתום לב, ועשויים להסתיר או להסיר את התוכן, לפנות למשתמש שהעלה אותו, או לבקש פרטים נוספים. המשתמש רשאי להגיב בכתב ולהסביר מדוע לדעתו אין הפרה («הודעת נגד»). נשקול את ההודעה ונודיע על ההחלטה, בלי שיהיה בכך כדי להכריע בסכסוך משפטי בין הצדדים. שמורה לנו הזכות לא להשיב לפניות חסרות או חוזרות בזדון.</p>",
        "<p>פניות שאינן קשורות להפרת קניין רוחני, וכן בקשות מחיקה של החשבון שלכם עצמכם, אפשר גם כן לשלוח לאותה כתובת.</p>"
      ].join("\n")
    }
  };

  function pageHtml(key) {
    var page = PAGES[key] || PAGES.terms;
    var body = page.html;
    return '<article class="legal-article" id="legal-article">' +
      '<p class="eyebrow">' + escapeHtml(page.kicker) + "</p>" +
      "<h1>" + escapeHtml(page.title) + "</h1>" +
      body +
      '<p class="legal-version">גרסה 1 · 16 בנובמבר 2026</p>' +
      "</article>";
  }

  function currentPage() {
    var hash = (location.hash || "").replace(/^#\/?/, "").split("/")[0];
    return PAGES[hash] ? hash : "";
  }

  function renderPage() {
    var root = $("view-legal");
    if (!root) return;
    var key = currentPage() || "terms";
    root.innerHTML = pageHtml(key);
  }

  function checkboxChecked() {
    var el = $("auth-legal-accept");
    return !!(el && el.checked);
  }

  function canStartAuth() {
    return checkboxChecked();
  }

  function rememberIntent() {
    try {
      localStorage.setItem(INTENT_KEY, JSON.stringify({ version: VERSION, at: new Date().toISOString() }));
    } catch (err) {}
  }

  function readIntent() {
    try {
      var raw = localStorage.getItem(INTENT_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (data && data.version === VERSION) return data;
    } catch (err) {}
    return null;
  }

  function clearIntent() {
    try { localStorage.removeItem(INTENT_KEY); } catch (err) {}
  }

  function resetCache() {
    cache = { loaded: false, accepted: false, version: "", media: false, userId: null };
  }

  function hasAccepted() {
    return !!(cache.loaded && cache.accepted && cache.version === VERSION);
  }

  function hasMediaConsent() {
    return !!cache.media;
  }

  function fetchRow() {
    var c = client();
    if (!c || !c.auth) return Promise.resolve(null);
    return c.auth.getUser().then(function (res) {
      var user = res && res.data && res.data.user;
      if (!user) return null;
      cache.userId = user.id;
      return c.from("legal_acceptances").select("terms_version, accepted_at, media_consent_at").eq("user_id", user.id).maybeSingle();
    }).then(function (res) {
      if (!res) return null;
      if (res.error) throw res.error;
      return res.data || null;
    });
  }

  function applyRow(row) {
    cache.loaded = true;
    cache.version = row && row.terms_version || "";
    cache.accepted = !!(row && row.terms_version === VERSION);
    cache.media = !!(row && row.media_consent_at);
  }

  function upsert(fields) {
    var c = client();
    if (!c) return Promise.reject(new Error("not configured"));
    return c.auth.getUser().then(function (res) {
      var user = res && res.data && res.data.user;
      if (!user) throw new Error("not signed in");
      var row = {
        user_id: user.id,
        terms_version: (fields && fields.terms_version) || cache.version || VERSION,
        updated_at: new Date().toISOString()
      };
      if (fields && fields.accepted_at) row.accepted_at = fields.accepted_at;
      else if (!cache.accepted) row.accepted_at = new Date().toISOString();
      if (fields && fields.media_consent_at) row.media_consent_at = fields.media_consent_at;
      else if (cache.media) row.media_consent_at = new Date().toISOString();
      return c.from("legal_acceptances").upsert(row, { onConflict: "user_id" }).select("terms_version, accepted_at, media_consent_at").maybeSingle();
    }).then(function (res) {
      if (res.error) throw res.error;
      applyRow(res.data || fields || { terms_version: VERSION, media_consent_at: fields && fields.media_consent_at });
      return true;
    });
  }

  function acceptTerms() {
    return upsert({ terms_version: VERSION, accepted_at: new Date().toISOString() }).then(function () {
      clearIntent();
      hideAcceptModal();
      return true;
    });
  }

  function acceptMedia() {
    return upsert({
      terms_version: cache.version || VERSION,
      accepted_at: cache.accepted ? undefined : new Date().toISOString(),
      media_consent_at: new Date().toISOString()
    }).then(function () {
      cache.media = true;
      return true;
    });
  }

  function showAcceptModal() {
    var box = $("legal-consent-modal");
    if (box) box.classList.remove("hidden");
    document.body.classList.add("legal-modal-open");
  }

  function hideAcceptModal() {
    var box = $("legal-consent-modal");
    if (box) box.classList.add("hidden");
    document.body.classList.remove("legal-modal-open");
  }

  function showMediaModal() {
    var box = $("legal-media-modal");
    if (box) box.classList.remove("hidden");
  }

  function hideMediaModal() {
    var box = $("legal-media-modal");
    if (box) box.classList.add("hidden");
    var check = $("legal-media-accept");
    if (check) check.checked = false;
  }

  var mediaWaiter = null;

  function promptMediaConsent() {
    if (hasMediaConsent()) return Promise.resolve(true);
    showMediaModal();
    return new Promise(function (resolve) {
      mediaWaiter = resolve;
    });
  }

  function confirmMedia() {
    var check = $("legal-media-accept");
    if (!check || !check.checked) {
      hooks.showToast("יש לאשר את ההצהרה לפני ההעלאה.");
      return;
    }
    acceptMedia().then(function () {
      hideMediaModal();
      if (mediaWaiter) { mediaWaiter(true); mediaWaiter = null; }
    }).catch(function () {
      hooks.showToast("לא הצלחנו לשמור את האישור. נסו שוב.");
    });
  }

  function cancelMedia() {
    hideMediaModal();
    if (mediaWaiter) { mediaWaiter(false); mediaWaiter = null; }
  }

  function onSignedIn() {
    return fetchRow().then(function (row) {
      if (row && row.terms_version === VERSION) {
        applyRow(row);
        hideAcceptModal();
        return true;
      }
      if (readIntent()) {
        return acceptTerms().then(function () {
          if (row && row.media_consent_at) cache.media = true;
          return true;
        });
      }
      applyRow(row);
      showAcceptModal();
      return false;
    }).catch(function () {
      cache.loaded = true;
      if (readIntent()) {
        return acceptTerms().catch(function () {
          showAcceptModal();
          return false;
        });
      }
      showAcceptModal();
      return false;
    });
  }

  function onSignedOut() {
    resetCache();
    hideAcceptModal();
    hideMediaModal();
  }

  function renderChrome(state) {
    state = state || {};
    var view = state.view || "";
    var isLegal = view === "legal";
    var isPublic = !!(state.publicCard || state.publicPair);
    var isOwnerCard = (view === "card" || view === "pair") && !isPublic && !state.adminPreview;
    var showFooter = isLegal || view === "home" || view === "login" || view === "profile" ||
      view === "result" || view === "quiz" || view === "share" || isOwnerCard;
    var foot = $("site-footer");
    if (foot) foot.classList.toggle("hidden", !showFooter);
    var share = $("share-legal");
    var pairShare = $("pair-share-legal");
    var showShare = (view === "card" || view === "pair" || view === "admin-view") && isPublic;
    if (share) share.classList.toggle("hidden", !(showShare && view !== "pair"));
    if (pairShare) pairShare.classList.toggle("hidden", !(showShare && (view === "pair")));
    var pending = cache.loaded && !hasAccepted() && !!cache.userId;
    if (isLegal) hideAcceptModal();
    else if (pending) showAcceptModal();
    var bar = $("legal-pending-bar");
    if (bar) bar.classList.toggle("hidden", !(isLegal && pending));
  }

  function bind() {
    var form = $("legal-consent-form");
    if (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var box = $("legal-modal-accept");
        if (!box || !box.checked) {
          hooks.showToast("יש לסמן את תיבת ההסכמה כדי להמשיך.");
          return;
        }
        acceptTerms().then(function () {
          hooks.showToast("תודה. אפשר להמשיך.");
        }).catch(function () {
          hooks.showToast("לא הצלחנו לשמור את האישור. נסו שוב.");
        });
      });
    }
    if ($("legal-media-yes")) $("legal-media-yes").addEventListener("click", confirmMedia);
    if ($("legal-media-no")) $("legal-media-no").addEventListener("click", cancelMedia);
    if ($("legal-pending-back")) {
      $("legal-pending-back").addEventListener("click", function () {
        hooks.go("home");
      });
    }
    var loginBox = $("auth-legal-accept");
    if (loginBox) {
      loginBox.addEventListener("change", function () {
        if (loginBox.checked) rememberIntent();
      });
    }
  }

  function init(opts) {
    hooks = Object.assign(hooks, opts || {});
    bind();
  }

  window.PadelLegal = {
    VERSION: VERSION,
    init: init,
    canStartAuth: canStartAuth,
    rememberIntent: rememberIntent,
    onSignedIn: onSignedIn,
    onSignedOut: onSignedOut,
    hasAccepted: hasAccepted,
    hasMediaConsent: hasMediaConsent,
    promptMediaConsent: promptMediaConsent,
    showAcceptModal: showAcceptModal,
    hideAcceptModal: hideAcceptModal,
    renderPage: renderPage,
    renderChrome: renderChrome,
    currentPage: currentPage
  };
})();
