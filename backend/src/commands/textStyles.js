const styles = {
  smallcaps: {'a':'ᴀ','b':'ʙ','c':'ᴄ','d':'ᴅ','e':'ᴇ','f':'ꜰ','g':'ɢ','h':'ʜ','i':'ɪ','j':'ᴊ','k':'ᴋ','l':'ʟ','m':'ᴍ','n':'ɴ','o':'ᴏ','p':'ᴘ','q':'ǫ','r':'ʀ','s':'ꜱ','t':'ᴛ','u':'ᴜ','v':'ᴠ','w':'ᴡ','x':'x','y':'ʏ','z':'ᴢ'},
  superscript: {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾','n':'ⁿ','i':'ⁱ'},
  subscript: {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','=':'₌','(':'₍',')':'₎','a':'ₐ','e':'ₑ','h':'ₕ','i':'ᵢ','j':'ⱼ','k':'ₖ','l':'ₗ','m':'ₘ','n':'ₙ','o':'ₒ','p':'ₚ','r':'ᵣ','s':'ₛ','t':'ₜ','u':'ᵤ','v':'ᵥ','x':'ₓ'},
  fauxcyrillic: {'a':'а','c':'с','e':'е','h':'һ','i':'і','j':'ј','k':'к','m':'м','o':'о','p':'р','s':'ѕ','t':'т','x':'х','y':'у','A':'А','B':'В','C':'С','E':'Е','H':'Н','K':'К','M':'М','O':'О','P':'Р','T':'Т','X':'Х'},
  fauxethiopic: {'a':'ል','b':'ც','c':'ር','d':'ძ','e':'乇','f':'ቻ','g':'ኗ','h':'ዘ','i':'ጎ','j':'ጋ','k':'ጕ','l':'ረ','m':'ጠ','n':'ክ','o':'ዐ','p':'የ','q':'ዒ','r':'尺','s':'丂','t':'ፕ','u':'ሁ','v':'ሀ','w':'ሠ','x':'ሸ','y':'ሃ','z':'ጊ'},
  rockdots: {'a':'ä','e':'ë','i':'ï','o':'ö','u':'ü','y':'ÿ','A':'Ä','E':'Ë','I':'Ï','O':'Ö','U':'Ü'},
  acute: {},
  inverted: {'a':'ɐ','b':'q','c':'ɔ','d':'p','e':'ǝ','f':'ɟ','g':'ƃ','h':'ɥ','i':'ᴉ','j':'ɾ','k':'ʞ','l':'ן','m':'ɯ','n':'u','r':'ɹ','t':'ʇ','v':'ʌ','w':'ʍ','y':'ʎ','?':'¿','!':'¡','(' : ')',')':'(','[':']',']':'[','{':'}','}':'{','<':'>','>':'<'},
};

const mathRanges = {
  mathbold: [[0x41,0x5a,0x1d400],[0x61,0x7a,0x1d41a],[0x30,0x39,0x1d7ce]],
  mathbolditalic: [[0x41,0x5a,0x1d468],[0x61,0x7a,0x1d482]],
  mathfraktur: [[0x41,0x5a,0x1d504],[0x61,0x7a,0x1d51e]],
  mathboldfraktur: [[0x41,0x5a,0x1d56c],[0x61,0x7a,0x1d586]],
  mathboldscript: [[0x41,0x5a,0x1d4d0],[0x61,0x7a,0x1d4ea]],
  mathdoublestruck: [[0x41,0x5a,0x1d538],[0x61,0x7a,0x1d552],[0x30,0x39,0x1d7d8]],
  mathmonospace: [[0x41,0x5a,0x1d670],[0x61,0x7a,0x1d68a],[0x30,0x39,0x1d7f6]],
  mathsans: [[0x41,0x5a,0x1d5a0],[0x61,0x7a,0x1d5ba],[0x30,0x39,0x1d7e2]],
};

const exceptions = {
  mathfraktur: {'C':'ℭ','H':'ℌ','I':'ℑ','R':'ℜ','Z':'ℨ'},
  mathboldscript: {'B':'ℬ','E':'ℰ','F':'ℱ','H':'ℋ','I':'ℐ','L':'ℒ','M':'ℳ','R':'ℛ','e':'ℯ','g':'ℊ','o':'ℴ'},
  mathdoublestruck: {'C':'ℂ','H':'ℍ','N':'ℕ','P':'ℙ','Q':'ℚ','R':'ℝ','Z':'ℤ'},
};

function mapMath(value, style) {
  const ranges = mathRanges[style];
  const exception = exceptions[style] || {};
  return Array.from(value, (char) => {
    if (exception[char]) return exception[char];
    const cp = char.codePointAt(0);
    for (const [start, end, target] of ranges) if (cp >= start && cp <= end) return String.fromCodePoint(target + cp - start);
    return char;
  }).join('');
}

export const styleNames = [
  'acute','allstyles','fullwidth','inverted','smallcaps','tagstyle','circled','circledneg','curvy1','curvy2','curvy3','parenthesized','squared','squaredneg',
  'mathbold','mathboldfraktur','mathbolditalic','mathboldscript','mathdoublestruck','mathfraktur','mathmonospace','mathsans','cjkthai','fauxcyrillic','fauxethiopic','regionalindicator','rockdots','stroked','subscript','superscript',
];

export function transformText(command, input) {
  const name = command.replace(/^\./, '');
  const text = String(input || '').slice(0, 1500);
  if (!text.trim()) return 'Add some text after the command.';
  if (name === 'allstyles') {
    return ['smallcaps','fullwidth','circled','mathbold','mathfraktur','mathmonospace','inverted'].map((style) => `${style}: ${transformText(`.${style}`, text)}`).join('\n');
  }
  if (name === 'fullwidth') return Array.from(text, (c) => c === ' ' ? '　' : (c.charCodeAt(0) >= 0x21 && c.charCodeAt(0) <= 0x7e ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join('');
  if (name === 'circled' || name === 'circledneg') return Array.from(text, (c) => {
    const n = c.charCodeAt(0);
    if (n >= 65 && n <= 90) return String.fromCodePoint((name === 'circled' ? 0x24b6 : 0x1f150) + n - 65);
    if (n >= 97 && n <= 122) return String.fromCodePoint((name === 'circled' ? 0x24d0 : 0x1f150) + n - 97);
    if (n >= 49 && n <= 57 && name === 'circled') return String.fromCodePoint(0x2460 + n - 49);
    if (c === '0' && name === 'circled') return '⓪';
    return c;
  }).join('');
  if (name === 'squared' || name === 'squaredneg') return Array.from(text, (c) => {
    const n = c.toUpperCase().charCodeAt(0);
    if (n >= 65 && n <= 90) return String.fromCodePoint((name === 'squared' ? 0x1f130 : 0x1f170) + n - 65);
    return c;
  }).join('');
  if (name === 'parenthesized') return Array.from(text, (c) => {
    const n = c.toLowerCase().charCodeAt(0);
    if (n >= 97 && n <= 122) return String.fromCodePoint(0x249c + n - 97);
    return c;
  }).join('');
  if (name === 'regionalindicator') return Array.from(text.toUpperCase(), (c) => {
    const n = c.charCodeAt(0);
    return n >= 65 && n <= 90 ? String.fromCodePoint(0x1f1e6 + n - 65) : c;
  }).join('');
  if (name === 'acute') return Array.from(text, (c) => /[a-z]/i.test(c) ? `${c}\u0301` : c).join('');
  if (name === 'stroked') return Array.from(text, (c) => ({a:'Ⱥ',b:'ƀ',c:'ȼ',d:'đ',e:'ɇ',g:'ǥ',h:'ħ',i:'ɨ',l:'ł',o:'ø',r:'ɍ',t:'ŧ',u:'ʉ',z:'ƶ',A:'Ⱥ',B:'Ƀ',D:'Đ',H:'Ħ',I:'Ɨ',L:'Ł',O:'Ø',T:'Ŧ'}[c] || c)).join('');
  if (name === 'tagstyle') return `『 ${text} 』`;
  if (name === 'curvy1') return `~${text}~`;
  if (name === 'curvy2') return `ღ ${text} ღ`;
  if (name === 'curvy3') return `༺ ${text} ༻`;
  if (mathRanges[name]) return mapMath(text, name);
  const mapping = styles[name];
  if (mapping) return Array.from(text, (c) => mapping[c] || c).join('');
  if (name === 'cjkthai') return Array.from(text, (c) => ({a:'丹',e:'乇',i:'工',o:'口',u:'凵',A:'丹',E:'乇',I:'工',O:'口',U:'凵'}[c] || c)).join('');
  return `Style “${name}” is not available.`;
}
