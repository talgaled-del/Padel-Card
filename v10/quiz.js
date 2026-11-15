/* שאלון קביעת רמה — ממופה לסולם האותיות הנפוץ בישראל: D2–A1 */
(function (global) {
  const LEVELS = [
    {
      id: "D2",
      numeric: "2.0",
      title: "מתחיל",
      min: 0,
      max: 8,
      blurb: "בתחילת הדרך. עדיין לומדים הגשה, מיקום ומגע נכון בכדור, ומתקשים לשמור ראלי ארוך."
    },
    {
      id: "D1",
      numeric: "2.5",
      title: "מתחיל מתקדם",
      min: 9,
      max: 14,
      blurb: "מחזיקים ראלי קצר ומתחילים להיות עקביים בהגשה ובהחזרה. היכרות ראשונית עם הזכוכית, לוב ועלייה לרשת."
    },
    {
      id: "C2",
      numeric: "3.0",
      title: "בינוני",
      min: 15,
      max: 21,
      blurb: "שולטים בחבטות הבסיסיות ושומרים על ראלי. מתחילים להשתמש בקירות, לובים וולים, ומבינים מתי לעלות לרשת. היציבות יורדת כשהקצב עולה."
    },
    {
      id: "C1",
      numeric: "3.5",
      title: "בינוני מתקדם",
      min: 22,
      max: 27,
      blurb: "יציבים יותר: מנהלים ראלי, מגינים מהקירות ובונים נקודה בסבלנות. לוב מכוון, וולי טוב יותר, ותחילת שילוב של בנדחה וויבורה."
    },
    {
      id: "B2",
      numeric: "4.0",
      title: "מתקדם",
      min: 28,
      max: 32,
      blurb: "משחקים יציב גם בקצב גבוה. מבינים מיקום וטקטיקה, הופכים הגנה להתקפה, ובונים נקודות עם כוונה ברורה."
    },
    {
      id: "B1",
      numeric: "4.5",
      title: "מתקדם מאוד",
      min: 33,
      max: 36,
      blurb: "שליטה גבוהה כמעט בכל מרכיבי המשחק. מעט טעויות לא מחויבות, החלטות מהירות, רשת חזקה, ויכולת לסיים נקודות במגוון דרכים."
    },
    {
      id: "A2",
      numeric: "5.0",
      title: "רמה גבוהה",
      min: 37,
      max: 39,
      blurb: "שחקנים תחרותיים ברמה גבוהה: קוראים את המשחק, מייצרים וסוגרים נקודות גם תחת לחץ, ומתקדמים בתחרויות בארץ."
    },
    {
      id: "A1",
      numeric: "5.0+",
      title: "עילית",
      min: 40,
      max: 48,
      blurb: "הרמה הגבוהה ביותר בסולם. שליטה מלאה בטכניקה, בקירות ובטקטיקה הזוגית, לרוב עם ניסיון תחרותי בכיר בארץ או בחו״ל. בישראל מדובר בשחקנים בודדים."
    }
  ];

  const QUESTIONS = [
    {
      id: "experience",
      text: "כמה זמן אתם משחקים פאדל?",
      hint: "רק ניסיון בפאדל, לא בענפים אחרים.",
      options: [
        { label: "רק התחלתי — כמה שבועות או פחות", score: 0 },
        { label: "כמה חודשים", score: 1 },
        { label: "בערך שנה עד שנתיים", score: 2 },
        { label: "יותר משנתיים", score: 4 }
      ]
    },
    {
      id: "frequency",
      text: "באיזו תדירות אתם משחקים?",
      options: [
        { label: "פחות מפעם בשבוע", score: 0 },
        { label: "בערך פעם בשבוע", score: 1 },
        { label: "שתיים–שלוש פעמים בשבוע", score: 3 },
        { label: "ארבע פעמים או יותר", score: 4 }
      ]
    },
    {
      id: "training",
      text: "אתם מתאמנים פאדל?",
      hint: "אימון עם מאמן, קבוצתי או פרטי — לא משחק רגיל.",
      options: [
        { label: "לא, רק משחק", score: 0 },
        { label: "התאמנתי בעבר או מדי פעם", score: 1 },
        { label: "כן, אימון קבוע פעם בשבוע", score: 3 },
        { label: "כן, כמה אימונים בשבוע", score: 4 }
      ]
    },
    {
      id: "racket-background",
      text: "יש לכם רקע בענפי מחבט אחרים, כמו טניס או סקווש?",
      options: [
        { label: "לא, הפאדל הוא ענף המחבט הראשון שלי", score: 0 },
        { label: "מעט, ברמה חובבנית", score: 1 },
        { label: "כן, ברמה טובה וקבועה", score: 3 },
        { label: "כן, שיחקתי תחרותית", score: 4 }
      ]
    },
    {
      id: "rally",
      text: "עד כמה אתם מצליחים להחזיק ראלי — להעביר כדורים ברצף?",
      options: [
        { label: "מתקשה לשמור כמה חבטות רצופות במגרש", score: 0 },
        { label: "מחזיק ראלי קצר, בעיקר בקצב איטי", score: 1 },
        { label: "מחזיק ראלי יציב בקצב סביר", score: 3 },
        { label: "מחזיק ראלי ארוך גם בקצב גבוה ותחת לחץ", score: 4 }
      ]
    },
    {
      id: "walls",
      text: "איך נראה משחק הקירות והזכוכית שלכם?",
      hint: "הקיר הוא קו פרשת המים בין מתחילים לבינוניים.",
      options: [
        { label: "כמעט לא מצליח להחזיר כדור שחזר מהקיר", score: 0 },
        { label: "היכרות ראשונית — לפעמים מצליח", score: 1 },
        { label: "מחזיר מהקיר בצורה סבירה ועקבית", score: 3 },
        { label: "מגן היטב מהקירות והופך הגנה להתקפה", score: 4 }
      ]
    },
    {
      id: "volley",
      text: "איך הוולי שלכם ברשת?",
      options: [
        { label: "כמעט אין וולי — נמנע מהרשת", score: 0 },
        { label: "וולי בסיסי מאוד, בעיקר כדי להשאיר כדור במשחק", score: 1 },
        { label: "וולי טוב ויציב, כל עוד אין לחץ גדול", score: 3 },
        { label: "משחק רשת חזק: שולט בכיוון, בקצב ובסיום", score: 4 }
      ]
    },
    {
      id: "lob",
      text: "איך אתם משתמשים בלוב?",
      options: [
        { label: "כמעט לא משתמש, או שהלוב לא מדויק", score: 0 },
        { label: "מנסה לוב, לא תמיד מצליח להוציא את היריבים", score: 1 },
        { label: "משתמש בלוב באופן מכוון כדי להוציא מהרשת", score: 3 },
        { label: "לוב מדויק שמכתיב את מהלך הנקודה", score: 4 }
      ]
    },
    {
      id: "bandeja",
      text: "איך הבנדחה (bandeja) שלכם?",
      hint: "חבטת ההגנה-התקפה מעל הראש, טיפוסית לפאדל.",
      options: [
        { label: "לא מכיר או לא מבצע", score: 0 },
        { label: "מנסה, עדיין לא יציב", score: 1 },
        { label: "מבצע בנדחה באופן סביר במשחק", score: 3 },
        { label: "בנדחה בשליטה, כחלק קבוע מבניית נקודה", score: 4 }
      ]
    },
    {
      id: "vibora",
      text: "איך הוויבורה והסמאש — חבטות הסיום מעל הראש?",
      options: [
        { label: "לא מבצע חבטות סיום מעל הראש", score: 0 },
        { label: "מתחיל לנסות, בלי עקביות", score: 1 },
        { label: "משלב ויבורה או סמאש מדי פעם", score: 3 },
        { label: "מסיים נקודות במגוון חבטות מעל הראש, באופן עקבי", score: 4 }
      ]
    },
    {
      id: "tactics",
      text: "איך נראה המשחק הזוגי והטקטיקה שלכם?",
      options: [
        { label: "בעיקר מחזיר כדור, בלי תוכנית ברורה", score: 0 },
        { label: "מבין מיקום בסיסי כזוג", score: 1 },
        { label: "בונה נקודה עם השותף ויודע מתי לעלות לרשת", score: 3 },
        { label: "קורא את המשחק, צופה מהלכים ומשנה תוכנית תוך כדי", score: 4 }
      ]
    },
    {
      id: "pressure",
      text: "מה קורה כשהקצב עולה או שיש לחץ?",
      options: [
        { label: "מאבד שליטה די מהר כשהקצב עולה", score: 0 },
        { label: "יציב בקצב סביר, מתקשה תחת לחץ", score: 1 },
        { label: "לא מחטיא כדורים פשוטים בלי לחץ, ומחזיק גם כשהקצב עולה", score: 3 },
        { label: "יציב בקצב גבוה, עם מעט מאוד טעויות לא מחויבות", score: 4 }
      ]
    },
    {
      id: "competition",
      text: "מה הניסיון שלכם בתחרויות פאדל?",
      options: [
        { label: "אף פעם לא התחריתי", score: 0 },
        { label: "השתתפתי בטורניר מועדון או משחק ידידותי מאורגן", score: 1 },
        { label: "מתחרה בתחרויות בארץ באופן קבוע", score: 3 },
        { label: "מתקדם בסיבובים בארץ, או מתחרה גם בחו״ל", score: 4 }
      ]
    }
  ];

  // Level thresholds are on a 0–48 scale; raw sums are scaled to it.
  var SCALE_MAX = 48;
  function totalScore(answers) {
    var raw = answers.reduce(function (sum, index, qIndex) {
      if (index == null || !QUESTIONS[qIndex] || !QUESTIONS[qIndex].options[index]) return sum;
      return sum + QUESTIONS[qIndex].options[index].score;
    }, 0);
    return Math.round(raw * SCALE_MAX / (QUESTIONS.length * 4));
  }

  function levelFromScore(score) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (score >= LEVELS[i].min && score <= LEVELS[i].max) return LEVELS[i];
    }
    return LEVELS[LEVELS.length - 1];
  }

  function levelById(id) {
    return LEVELS.find(function (l) { return l.id === id; }) || null;
  }

  global.PadelQuiz = {
    QUESTIONS: QUESTIONS,
    LEVELS: LEVELS,
    totalScore: totalScore,
    levelFromScore: levelFromScore,
    levelById: levelById,
    maxScore: SCALE_MAX
  };
})(window);
