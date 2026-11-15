(function (global) {
  const DB_KEY = "padelCard.db.v1";

  function portrait(cfg) {
    var hair = "";
    if (cfg.hairStyle === "short") {
      hair = '<path d="M52 96c4-44 28-62 48-62s44 18 48 62c-10-22-26-30-48-30S62 74 52 96Z" fill="' + cfg.hair + '"/>';
    } else if (cfg.hairStyle === "buzz") {
      hair = '<path d="M58 92c6-32 22-46 42-46s36 14 42 46c-8-16-22-22-42-22S66 76 58 92Z" fill="' + cfg.hair + '"/>';
    } else if (cfg.hairStyle === "long") {
      hair = '<path d="M46 88c6-50 30-72 54-72s48 22 54 72v70c-8 8-20 6-28-8 0-22-8-30-26-30s-26 8-26 30c-8 14-20 16-28 8V88Z" fill="' + cfg.hair + '"/>';
    } else if (cfg.hairStyle === "bun") {
      hair = '<circle cx="100" cy="36" r="16" fill="' + cfg.hair + '"/><path d="M52 98c4-44 28-60 48-60s44 16 48 60c-10-20-26-28-48-28S62 78 52 98Z" fill="' + cfg.hair + '"/>';
    } else if (cfg.hairStyle === "wavy") {
      hair = '<path d="M48 100c2-50 30-74 52-74 24 0 50 20 52 74-8-18-16-10-24-28-8 16-16 4-28 4s-20 12-28-4c-8 18-16 10-24 28Z" fill="' + cfg.hair + '"/>';
    } else if (cfg.hairStyle === "curly") {
      hair = '<circle cx="68" cy="58" r="18" fill="' + cfg.hair + '"/><circle cx="100" cy="44" r="20" fill="' + cfg.hair + '"/><circle cx="132" cy="58" r="18" fill="' + cfg.hair + '"/><circle cx="58" cy="86" r="14" fill="' + cfg.hair + '"/><circle cx="142" cy="86" r="14" fill="' + cfg.hair + '"/>';
    } else if (cfg.hairStyle === "side") {
      hair = '<path d="M56 70c8-40 30-52 50-52 14 0 30 8 38 28-18 2-28 8-30 22 4-36-14-40-34-28-8 6-16 16-24 30Z" fill="' + cfg.hair + '"/>';
    } else {
      hair = '<path d="M50 100c6-46 28-66 50-66s44 20 50 66c-12-24-28-32-50-32S62 76 50 100Z" fill="' + cfg.hair + '"/>';
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
      '<rect width="200" height="200" fill="' + cfg.bg + '"/>' +
      '<circle cx="100" cy="210" r="78" fill="' + cfg.shirt + '"/>' +
      '<circle cx="100" cy="102" r="46" fill="' + cfg.skin + '"/>' +
      hair +
      '<ellipse cx="84" cy="104" rx="5" ry="6" fill="#2a1c14" opacity="0.7"/>' +
      '<ellipse cx="116" cy="104" rx="5" ry="6" fill="#2a1c14" opacity="0.7"/>' +
      '<path d="M90 122c6 8 14 8 20 0" fill="none" stroke="#b07060" stroke-width="2.2" stroke-linecap="round"/>' +
      '</svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  var SEEDS = [
    {
      id: "seed-michal",
      name: "מיכל לוי",
      gender: "female",
      age: 29,
      hand: "right",
      side: "right",
      competitor: "no",
      levelId: "C1",
      score: 25,
      videos: [{ id: "s1", name: "קישור לסרטון", link: "https://youtu.be/padel-michal" }],
      photo: "avatars/michal.jpg"
    },
    {
      id: "seed-alon",
      name: "אלון כהן",
      gender: "male",
      age: 34,
      hand: "right",
      side: "left",
      competitor: "no",
      levelId: "C1",
      score: 24,
      videos: [{ id: "s2", name: "קישור לסרטון", link: "https://youtu.be/padel-alon" }],
      photo: "avatars/alon.jpg"
    },
    {
      id: "seed-yuval",
      name: "יובל מזרחי",
      gender: "male",
      age: 41,
      hand: "left",
      side: "either",
      competitor: "yes",
      levelId: "B2",
      score: 30,
      videos: [{ id: "s3", name: "קישור לסרטון", link: "https://youtu.be/padel-yuval" }],
      photo: "avatars/yuval.jpg"
    },
    {
      id: "seed-shira",
      name: "שירה אברהם",
      gender: "female",
      age: 25,
      hand: "right",
      side: "left",
      competitor: "no",
      levelId: "C2",
      score: 18,
      videos: [{ id: "s4", name: "קישור לסרטון", link: "https://youtu.be/padel-shira" }],
      photo: "avatars/shira.jpg"
    },
    {
      id: "seed-daniel",
      name: "דניאל חדד",
      gender: "male",
      age: 32,
      hand: "right",
      side: "right",
      competitor: "yes",
      levelId: "B1",
      score: 34,
      videos: [{ id: "s5", name: "קישור לסרטון", link: "https://youtu.be/padel-daniel" }],
      photo: "avatars/daniel.jpg"
    },
    {
      id: "seed-noa",
      name: "נועה ברק",
      gender: "female",
      age: 30,
      hand: "left",
      side: "left",
      competitor: "no",
      levelId: "C1",
      score: 23,
      videos: [{ id: "s6", name: "קישור לסרטון", link: "https://youtu.be/padel-noa" }],
      photo: "avatars/noa.jpg"
    },
    {
      id: "seed-itay",
      name: "איתי שמש",
      gender: "male",
      age: 22,
      hand: "right",
      side: "either",
      competitor: "no",
      levelId: "D1",
      score: 11,
      videos: [],
      photo: "avatars/itay.jpg"
    },
    {
      id: "seed-roni",
      name: "רוני גולן",
      gender: "male",
      age: 38,
      hand: "left",
      side: "right",
      competitor: "yes",
      levelId: "B2",
      score: 31,
      videos: [{ id: "s8", name: "קישור לסרטון", link: "https://youtu.be/padel-roni" }],
      photo: "avatars/roni.jpg"
    }
  ];


  var SEED_EXTRAS = {
    "seed-michal": { region: "telaviv", courts: ["פאדל ת״א צפון", "פאדל יפו"], frequency: "2-3", tenure: "3-5", style: "both", shots: ["vibora", "walls", "volley"], playtomic: "3.4", association: "3.5", phone: "0529876543", hidePhone: false },
    "seed-alon": { region: "sharon", courts: ["פאדל הרצליה"], frequency: "2-3", tenure: "5plus", style: "social", shots: ["bandeja", "lob", "defense"], playtomic: "3.3", association: "", phone: "0541112233", hidePhone: true },
    "seed-yuval": { region: "center", courts: ["פאדל ראשון לציון"], frequency: "4plus", tenure: "5plus", style: "competitive", shots: ["smash", "vibora", "volley"], playtomic: "4.1", association: "4.0", phone: "0507654321", hidePhone: false },
    "seed-shira": { region: "jerusalem", courts: ["פאדל ירושלים"], frequency: "weekly", tenure: "1-2", style: "social", shots: ["lob", "walls"], playtomic: "2.8", association: "3.0", phone: "", hidePhone: false },
    "seed-daniel": { region: "haifa", courts: ["פאדל חיפה", "קריית מוצקין"], frequency: "4plus", tenure: "3-5", style: "competitive", shots: ["smash", "bandeja", "volley"], playtomic: "4.6", association: "4.5", phone: "0532223344", hidePhone: false },
    "seed-noa": { region: "shfela", courts: ["פאדל רחובות"], frequency: "2-3", tenure: "1-2", style: "both", shots: ["walls", "defense", "lob"], playtomic: "3.5", association: "", phone: "0583334455", hidePhone: true },
    "seed-itay": { region: "south", courts: ["פאדל באר שבע"], frequency: "weekly", tenure: "under1", style: "social", shots: ["defense"], playtomic: "1.8", association: "", phone: "", hidePhone: false },
    "seed-roni": { region: "north", courts: ["פאדל כנרת"], frequency: "2-3", tenure: "5plus", style: "competitive", shots: ["vibora", "smash", "walls"], playtomic: "4.0", association: "4.0", phone: "0524445566", hidePhone: false }
  };
  SEEDS.forEach(function (p) {
    var extra = SEED_EXTRAS[p.id];
    if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
  });

  var NUMERIC = { D2: 2, D1: 2.5, C2: 3, C1: 3.5, B2: 4, B1: 4.5, A2: 5, A1: 5.25 };
  var ORDER = ["D2", "D1", "C2", "C1", "B2", "B1", "A2", "A1"];

  function letterFromNumeric(n) {
    var best = "D2";
    var dist = 99;
    ORDER.forEach(function (id) {
      var d = Math.abs(NUMERIC[id] - n);
      if (d < dist) { dist = d; best = id; }
    });
    return best;
  }

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(DB_KEY) || "[]"); }
    catch (err) { return []; }
  }

  function allPlayers() {
    var byId = {};
    SEEDS.forEach(function (p) { byId[p.id] = p; });
    loadLocal().forEach(function (p) { byId[p.id] = p; });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function findById(id) {
    if (!id) return null;
    var list = allPlayers();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function searchByName(query, excludeId) {
    var q = (query || "").trim().toLowerCase();
    return allPlayers().filter(function (p) {
      if (excludeId && p.id === excludeId) return false;
      if (!q) return true;
      return (p.name || "").toLowerCase().indexOf(q) !== -1;
    });
  }

  function upsert(player) {
    var local = loadLocal().filter(function (p) { return p.id !== player.id; });
    local.push(player);
    localStorage.setItem(DB_KEY, JSON.stringify(local));
  }

  function pairSummary(a, b) {
    var na = NUMERIC[a.levelId] || 3;
    var nb = NUMERIC[b.levelId] || 3;
    var avg = (na + nb) / 2;
    var letter = letterFromNumeric(avg);
    var level = global.PadelQuiz ? PadelQuiz.levelById(letter) : null;
    var gap = Math.abs(na - nb);
    var gapText = gap === 0 ? "רמה זהה" : gap <= 0.5 ? "פער קטן" : gap <= 1 ? "פער בינוני" : "פער רמות ניכר";
    var sa = a.profile ? a.profile.side : a.side;
    var sb = b.profile ? b.profile.side : b.side;
    var ha = a.profile ? a.profile.hand : a.hand;
    var hb = b.profile ? b.profile.hand : b.hand;
    var sidesFit = (sa === "right" && sb === "left") || (sa === "left" && sb === "right") || sa === "either" || sb === "either";
    var sideText;
    if ((sa === "right" && sb === "left") || (sa === "left" && sb === "right")) {
      sideText = "צדדים משלימים: ימין + שמאל";
    } else if (sa === "either" || sb === "either") {
      sideText = "גמישות בצדדים — לפחות אחד מהשניים גמיש בעמדות";
    } else if (sa === sb) {
      sideText = "שניהם מעדיפים את צד " + (sa === "right" ? "ימין" : "שמאל");
    } else {
      sideText = "העדפות הצד דורשות תיאום";
    }
    var handText = ha === hb
      ? (ha === "right" ? "שתי ידיים ימניות" : "שתי ידיים שמאליות")
      : "יד ימין + יד שמאל";
    var blurb = "זוג ברמת " + (level ? level.title : letter) + " (" + letter + "). " + gapText + ". " + sideText + ".";
    return {
      letter: letter,
      numeric: level ? level.numeric : String(avg),
      title: level ? level.title : "",
      gap: gapText,
      gapValue: gap,
      sidesFit: sidesFit,
      sideText: sideText,
      handText: handText,
      blurb: blurb
    };
  }

  global.PadelDB = {
    SEEDS: SEEDS,
    allPlayers: allPlayers,
    findById: findById,
    searchByName: searchByName,
    upsert: upsert,
    pairSummary: pairSummary,
    letterFromNumeric: letterFromNumeric,
    NUMERIC: NUMERIC,
    portrait: portrait
  };
})(window);
