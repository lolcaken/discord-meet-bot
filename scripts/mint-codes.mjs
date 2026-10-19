/**
 * Mint spaces and rank the codes Google hands back.
 *
 * meetingCode is output-only - the API ignores any code you ask for, so the
 * only way to get a memorable one is to sample until the right structure
 * shows up. Scoring favours real words in the 3 and 4 letter slots, doubled
 * letters, mirrored halves, and vowel balance; it punishes consonant clumps,
 * confusable letters and accidental words.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createOpenMeetSpace } from "./src/googleMeet.js";

const WANT = 40;
const MAX_WAITS = 4; // rate-limit windows we're willing to sit through

const out = [];
const say = (s) => { out.push(s); writeFileSync("codes.txt", out.join("\n") + "\n", "utf8"); };

const THREE = new Set((
  "ace age aid aim air ape arc art axe bad bag bar bat bay bed bee bet big bit bob bog box boy bud bug bun bus " +
  "buy cab cam cap car cat cog cop cow cry cub cue cup cut dad dam day den dig dim dip doc dog dot dry dub dud " +
  "due dug dye ear eat eel egg ego elf elk elm end era eve eye fad fan far fat fax fed fee few fig fin fit fix fly " +
  "foe fog for fox fun fur gag gap gas gem get gig gin god got gum gun gut guy gym ham hat hem hen hey hip hit " +
  "hop hot hub hug hum hut ice icy ill ink inn ion ire its ivy jam jar jaw jay jet jew jig job jog joy jug key kid " +
  "kit lab lad lag lap law lay leg let lid lie lip lit log lot low man map mat may men mix mob mom mop mud mug " +
  "mum nag nap net new nib nil nip nod nor not now nun nut oak oar oat odd ode off oil old one opt orb ore our " +
  "out owl own pad pal pan pat paw pay pea peg pen pet pew pie pig pin pit ply pod pot pro pry pub pug pun pup " +
  "rag ram ran rap rat raw ray red rib rid rig rim rip rob rod rot row rub rug rum run rut rye sad sag sap sat " +
  "saw say sea see set sew shy sin sip sir sit six sky sly sob son sow soy spa spy sub sun tan tap tax tea ten " +
  "the tic tie tin tip toe ton top tow toy try tub tug two urn use van vat vet vow wag war was wax way web wed " +
  "wet who why wig win wit woe won wow wry yak yam yap yen yes yet yew you zap zen zig zip zoo"
).split(" "));

const FOUR = new Set((
  "acid ajax also aqua atom auto away axis back ball band bank bark base bath beam bean bear beat beer bell " +
  "belt best bike bird bite blue boat body bomb bone book boot bore born both bowl bulk burn busy buzz cafe " +
  "cake calm came camp card care case cash cast cave cell chat chef chin chip city clan clap claw clay clip " +
  "club coal coat code coin cold comb come cook cool copy core corn cost crew crop cube curl cute dash data " +
  "dawn dead deal dear deep deer dial dice diet dime dine dirt disc dive dock dome doom door dose dove down " +
  "drag draw drew drip drop drum duck dumb dune dusk dust duty earn ease east easy edge epic even ever evil " +
  "exit face fact fade fail fair fake fall fame farm fast fate fear feed feel feet fell felt file fill film find " +
  "fine fire firm fish fist five flag flat flaw flea flew flip flow foam fold folk food fool foot ford fork " +
  "form fort foul four free frog from fuel full fund fury gain game gang gate gear gift girl give glad glow " +
  "glue goal gold golf gone good gown grab gray grid grim grip grow gulf hail hair half hall halo hand hang " +
  "hard harm hawk haze head heal heap hear heat heel heir held hell helm help herb hero hide high hill hint " +
  "hire hive hold hole holy home hood hook hope horn host hour huge hunt hurt iron item jade jazz jeep join " +
  "joke jump keen keep kick kill kind king kiss kite knee knew knit knob lace lack lady laid lake lamb lame " +
  "lamp land lane last late lawn lazy lead leaf leak lean leap left lend lens lift like lily limb lime line " +
  "link lion list live load loan lock loft logo lone long look loop lord lore lose loss lost loud love luck " +
  "lure lust made mail main make male mall mane many mark mask mass mast mate math maze meal mean meat meek " +
  "meet melt mend menu mere mesh mess mild mile milk mill mind mine mint miss mist mode mold mole monk mood " +
  "moon moor more moss most moth move much mule muse must mute nail name navy near neat neck need nest news " +
  "next nice nick nine none noon norm nose note noun nude obey odds okay omen omit once ones only onto open " +
  "oral ouch oust oval oven over owed pace pack page paid pail pain pair pale palm pane park part pass past " +
  "path pave pawn peak peal pear peat peel peer pelt perk pest pier pile pine pink pint pipe plan play plot " +
  "plow plug plum plus poem poet pole poll pond pool poor pope pore pork port pose post pour pray prey prod " +
  "prof prom prop pull pulp pump punk pure push race rack raft rage raid rail rain rake ramp rank rare rash " +
  "rate rave read real reap rear rely rent rest rice rich ride rift ring riot ripe rise risk road roam roar " +
  "robe rock rode role roll roof room root rope rose rule rush rust sage sail salt same sand sane sang sank " +
  "save scan seal seam seat seed seek seem seen self sell send sent shed ship shoe shop shot show shut sick " +
  "side sift sigh sign silk sill sing sink site size skin slab slam slip slot slow slug snap snip snug soap " +
  "soar sock soda sofa soft soil sold sole solo some song soon sore sort soul soup sour span spar spat sped " +
  "spin spit spot star stay stem step stew stir stop stow such suit sung sunk sure surf swan swap swim tail " +
  "take tale talk tall tame tank tape task team tear tech teem tell tend tent term test text than that them " +
  "then they thin this thud thus tick tide tidy tier tile tilt time tiny tire toad toil told toll tomb " +
  "tone took tool torn tour town trap tray tree trek trim trio trip trot true tube tuck tuna tune turf turn twin " +
  "type ugly undo unit unto upon urge used user vain vale vane vast veal veil vein vend vent verb very vest " +
  "veto vial vibe vice view vine visa void volt vote wade wage wail wait wake walk wall wand want ward warm " +
  "warn warp wash wasp wave wavy weak wear weed week weep well went wept were west what when whim whip wick " +
  "wide wife wild will wilt wind wine wing wink wire wise wish with wolf wood wool word wore work worm worn " +
  "wrap yard yarn yawn year yell yelp yoga yoke yolk your zero zest zinc zoom"
).split(" "));

const CONFUSABLE = new Set(["l", "i", "o", "b", "s", "z", "g", "q", "c", "e"]);
const AVOID = ["ass", "fuk", "fuc", "cum", "tit", "nig", "gay", "pee", "poo", "wtf", "dck", "kkk", "xxx", "jjj", "ppp", "vvv", "uuu"];

function score(code) {
  const [a, b, c] = code.split("-");
  let s = 0;
  const why = [];

  if (THREE.has(a)) { s += 9; why.push(`"${a}"`); }
  if (THREE.has(c)) { s += 9; why.push(`"${c}"`); }
  if (FOUR.has(b)) { s += 14; why.push(`"${b}"`); }

  for (const p of [a, b, c]) if (/([a-z])\1/.test(p)) { s += 7; why.push("double"); break; }
  if ([...a].reverse().join("") === a) { s += 6; why.push("palindrome"); }
  if (a === c) { s += 10; why.push("mirrored"); }
  if (a[0] === c[2] && a[2] === c[0]) { s += 5; why.push("crossed"); }
  if (b === [...b].reverse().join("")) { s += 4; }

  const vr = (b.match(/[aeiou]/g) || []).length;
  if (vr === 2) s += 4; else if (vr === 1 || vr === 3) s += 1;
  if (/[aeiou][bcdfghjklmnpqrstvwxyz]|[bcdfghjklmnpqrstvwxyz][aeiou]/.test(b)) s += 2;
  if (new Set(code.replace(/-/g, "")).size >= 9) s += 2;

  for (const bad of AVOID) if (code.includes(bad)) { s -= 30; why.push("avoids a word"); }
  if (/[bcdfghjklmnpqrstvwxz]{4}/.test(b)) { s -= 7; why.push("clump"); }
  if ([...new Set(code.replace(/-/g, "").split("").filter((ch) => CONFUSABLE.has(ch)))].length >= 4) {
    s -= 5; why.push("muddy to read");
  }
  if (new Set(code.replace(/-/g, "")).size <= 7) { s -= 4; why.push("repetitive"); }

  return { s, why };
}

say(`Minting up to ${WANT} spaces (pacing through Google's create-space rate limit)...\n`);

const seen = new Set();
let waits = 0;
while (seen.size < WANT && waits < MAX_WAITS) {
  try {
    const { meetingCode } = await createOpenMeetSpace();
    if (!seen.has(meetingCode)) {
      seen.add(meetingCode);
      say(`  ${String(seen.size).padStart(2)}  ${meetingCode}`);
    }
  } catch (err) {
    if (/\(429\)/.test(err.message)) {
      waits++;
      say(`  rate limited, waiting 65s (${waits}/${MAX_WAITS})...`);
      await new Promise((r) => setTimeout(r, 65000));
    } else {
      say(`  FAILED: ${String(err.message).slice(0, 100)}`);
      break;
    }
  }
}

const ranked = [...seen].map((code) => ({ code, ...score(code) })).sort((x, y) => y.s - x.s);

say(`\n# ${ranked.length} codes, best first\n`);
say("| # | Code | Score | Notes |");
say("| ---: | --- | ---: | --- |");
ranked.forEach((r, i) => say(`| ${i + 1} | \`${r.code}\` | ${r.s} | ${r.why.slice(0, 3).join(", ") || "even and clean"} |`));

say("\n**Winners:**");
ranked.slice(0, 8).forEach((r) => say(`  ${String(r.s).padStart(3)}  \`${r.code}\`  ${r.why.join(" · ")}`));
