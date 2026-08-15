const literalTypoPairs = [
  ['按装', '安装'], ['安祥', '安详'], ['暴燥', '暴躁'], ['抱谦', '抱歉'],
  ['必竟', '毕竟'], ['编篡', '编纂'], ['不径而走', '不胫而走'], ['不落巢臼', '不落窠臼'],
  ['穿流不息', '川流不息'], ['粗旷', '粗犷'], ['打腊', '打蜡'], ['渡假', '度假'],
  ['防碍', '妨碍'], ['幅射', '辐射'], ['甘败下风', '甘拜下风'], ['鬼鬼崇崇', '鬼鬼祟祟'],
  ['侯车', '候车'], ['既使', '即使'], ['即然', '既然'], ['娇揉造作', '矫揉造作'],
  ['竭泽而鱼', '竭泽而渔'], ['金璧辉煌', '金碧辉煌'], ['决择', '抉择'], ['烩炙人口', '脍炙人口'],
  ['兰天白云', '蓝天白云'], ['老俩口', '老两口'], ['了望', '瞭望'], ['另售', '零售'],
  ['名信片', '明信片'], ['默守成规', '墨守成规'], ['迫不急待', '迫不及待'], ['气慨', '气概'],
  ['青睐有加', '青眼有加'], ['融汇贯通', '融会贯通'], ['入场卷', '入场券'], ['世外桃园', '世外桃源'],
  ['松驰', '松弛'], ['谈笑风声', '谈笑风生'], ['天翻地复', '天翻地覆'], ['一愁莫展', '一筹莫展'],
  ['一股作气', '一鼓作气'], ['再接再励', '再接再厉'], ['走头无路', '走投无路'], ['蛛丝蚂迹', '蛛丝马迹'],
  ['震憾', '震撼'], ['帐蓬', '帐篷'], ['坐阵', '坐镇'], ['挖墙角', '挖墙脚'],
  ['薄菏', '薄荷'], ['按步就班', '按部就班'], ['按奈不住', '按捺不住'], ['暗然失色', '黯然失色'],
  ['白壁微瑕', '白璧微瑕'], ['百尺杆头', '百尺竿头'], ['鞭辟入理', '鞭辟入里'], ['变本加利', '变本加厉'],
  ['病入膏盲', '病入膏肓'], ['并行不背', '并行不悖'], ['不醒人事', '不省人事'], ['沧海一栗', '沧海一粟'],
  ['草管人命', '草菅人命'], ['侧隐之心', '恻隐之心'], ['称心如义', '称心如意'], ['出奇不意', '出其不意'],
  ['出人投地', '出人头地'], ['唇枪舌箭', '唇枪舌剑'], ['大才小用', '大材小用'], ['大名顶顶', '大名鼎鼎'],
  ['大有稗益', '大有裨益'], ['惮精竭虑', '殚精竭虑'], ['得不尝失', '得不偿失'], ['独挡一面', '独当一面'],
  ['蜂涌而至', '蜂拥而至'], ['浮想联篇', '浮想联翩'], ['风糜一时', '风靡一时'], ['关怀倍至', '关怀备至'],
  ['汗流夹背', '汗流浃背'], ['好高鹜远', '好高骛远'], ['和霭可亲', '和蔼可亲'], ['轰堂大笑', '哄堂大笑'],
  ['换然一新', '焕然一新'], ['黄梁一梦', '黄粱一梦'], ['混身是胆', '浑身是胆'], ['既往不究', '既往不咎'],
  ['记忆尤新', '记忆犹新'], ['戒骄戒燥', '戒骄戒躁'], ['金榜提名', '金榜题名'], ['精兵减政', '精兵简政'],
  ['精神焕散', '精神涣散'], ['精萃', '精粹'], ['举世振惊', '举世震惊'], ['刻骨名心', '刻骨铭心'],
  ['可望不可既', '可望不可即'], ['苦心孤旨', '苦心孤诣'], ['脍灸人口', '脍炙人口'], ['滥芋充数', '滥竽充数'],
  ['老生长谈', '老生常谈'], ['礼上往来', '礼尚往来'], ['流连忘反', '流连忘返'], ['满腹经论', '满腹经纶'],
  ['貌和神离', '貌合神离'], ['冒然', '贸然'], ['美仑美奂', '美轮美奂'], ['名列前矛', '名列前茅'],
  ['明察秋豪', '明察秋毫'], ['明火执杖', '明火执仗'], ['摩肩接重', '摩肩接踵'], ['目不交捷', '目不交睫'],
  ['旁证博引', '旁征博引'], ['披星带月', '披星戴月'], ['篷荜生辉', '蓬荜生辉'], ['凭心而论', '平心而论'],
  ['破斧沉舟', '破釜沉舟'], ['前扑后继', '前仆后继'], ['轻歌慢舞', '轻歌曼舞'], ['磬竹难书', '罄竹难书'],
  ['人才倍出', '人才辈出'], ['如法泡制', '如法炮制'], ['弱不经风', '弱不禁风'], ['色彩斑澜', '色彩斑斓'],
  ['山青水秀', '山清水秀'], ['生灵涂碳', '生灵涂炭'], ['始作蛹者', '始作俑者'], ['挺而走险', '铤而走险'],
  ['头晕目炫', '头晕目眩'], ['相形见拙', '相形见绌'], ['相辅相承', '相辅相成'], ['消声匿迹', '销声匿迹'],
  ['心无旁鹜', '心无旁骛'], ['兴高彩烈', '兴高采烈'], ['悬梁刺骨', '悬梁刺股'], ['鸦鹊无声', '鸦雀无声'],
  ['淹淹一息', '奄奄一息'], ['眼花瞭乱', '眼花缭乱'], ['要言不繁', '要言不烦'], ['一诺千斤', '一诺千金'],
  ['一如即往', '一如既往'], ['一泄千里', '一泻千里'], ['以逸代劳', '以逸待劳'], ['引疚自责', '引咎自责'],
  ['饮鸠止渴', '饮鸩止渴'], ['有持无恐', '有恃无恐'], ['原形必露', '原形毕露'], ['怨天由人', '怨天尤人'],
  ['运筹帷握', '运筹帷幄'], ['责无旁代', '责无旁贷'], ['真知卓见', '真知灼见'], ['针贬时弊', '针砭时弊'],
  ['震聋发聩', '振聋发聩'], ['直接了当', '直截了当'], ['支离破粹', '支离破碎'], ['众口烁金', '众口铄金'],
  ['追朔', '追溯'], ['装祯', '装帧'], ['姿意妄为', '恣意妄为'], ['自抱自弃', '自暴自弃'],
  ['作崇', '作祟'], ['坐想其成', '坐享其成'], ['报歉', '抱歉'], ['凑和', '凑合'],
  ['迁徒', '迁徙'], ['修茸', '修葺'], ['痉孪', '痉挛'], ['蜇伏', '蛰伏']
];

const patternTypoRules = [
  { id: 'punctuation-repeat', pattern: '([，；：])\\1+', flags: 'g', replacement: '$1', label: '重复标点' },
  { id: 'punctuation-comma', pattern: '([\\u3400-\\u9fff]),(?=[\\u3400-\\u9fff])', flags: 'g', replacement: '$1，', label: '中英文标点混用' },
  { id: 'punctuation-semicolon', pattern: '([\\u3400-\\u9fff]);(?=[\\u3400-\\u9fff])', flags: 'g', replacement: '$1；', label: '中英文标点混用' },
  { id: 'punctuation-colon', pattern: '([\\u3400-\\u9fff]):(?=[\\u3400-\\u9fff])', flags: 'g', replacement: '$1：', label: '中英文标点混用' },
  { id: 'punctuation-question', pattern: '([\\u3400-\\u9fff])\\?(?=[\\u3400-\\u9fff])', flags: 'g', replacement: '$1？', label: '中英文标点混用' },
  { id: 'punctuation-exclamation', pattern: '([\\u3400-\\u9fff])!(?=[\\u3400-\\u9fff])', flags: 'g', replacement: '$1！', label: '中英文标点混用' },
  { id: 'book-mark-image-open', pattern: '!\\[([^\\]《\\n]{1,60}》)', flags: 'g', replacement: '![《$1', label: '书名号不配对' },
  { id: 'book-mark-image-close', pattern: '!\\[(《[^\\]》\\n]{1,60})\\]', flags: 'g', replacement: '![$1》]', label: '书名号不配对' }
];

export const typoRules = Object.freeze([
  ...literalTypoPairs.map(([wrong, correct], index) => ({
    id: `typo-${index + 1}`,
    kind: 'literal',
    label: '常见错别字',
    wrong,
    correct
  })),
  ...patternTypoRules.map(rule => Object.freeze({ kind: 'pattern', ...rule }))
]);

function searchableText(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, match => match.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]+`/g, match => ' '.repeat(match.length))
    .replace(/(!?\[[^\]\n]*\])(\([^\n)]*\))/g, (match, label, target) => label + target.replace(/[^\n]/g, ' '))
    .replace(/https?:\/\/[^\s)]+/g, match => ' '.repeat(match.length));
}

function matchesForRule(searchable, rule) {
  if (!rule.pattern) {
    const matches = [];
    let from = 0;
    while (from < searchable.length) {
      const index = searchable.indexOf(rule.wrong, from);
      if (index < 0) break;
      matches.push({ index, wrong: rule.wrong, correct: rule.correct });
      from = index + rule.wrong.length;
    }
    return matches;
  }

  const flags = rule.flags && rule.flags.includes('g') ? rule.flags : `${rule.flags || ''}g`;
  const expression = new RegExp(rule.pattern, flags);
  const matches = [];
  let match;
  while ((match = expression.exec(searchable))) {
    matches.push({
      index: match.index,
      wrong: match[0],
      correct: rule.replacement.replace(/\$&|\$(\d+)/g, (token, group) => {
        return token === '$&' ? match[0] : (match[Number(group)] || '');
      })
    });
    if (!match[0].length) expression.lastIndex += 1;
  }
  return matches;
}

export function detectTypos(markdown, rules = typoRules) {
  const source = String(markdown || '');
  const searchable = searchableText(source);
  const issues = [];
  for (const rule of rules) {
    for (const match of matchesForRule(searchable, rule)) {
      const { index, wrong, correct } = match;
      const before = source.slice(0, index);
      const line = before.split('\n').length;
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineEnd = source.indexOf('\n', index);
      const fullLine = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim();
      issues.push({
        id: `${rule.id}-${index}`,
        ruleId: rule.id,
        index,
        kind: rule.kind || 'literal',
        label: rule.label || '常见错别字',
        wrong,
        correct,
        line,
        column: index - lineStart + 1,
        context: fullLine.length > 96 ? `${fullLine.slice(0, 93)}…` : fullLine
      });
    }
  }
  return issues.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function applyTypoCorrections(markdown, ruleIds, rules = typoRules) {
  const source = String(markdown || '');
  const selected = new Set(ruleIds || []);
  return detectTypos(source, rules)
    .filter(issue => selected.has(issue.ruleId))
    .sort((a, b) => b.index - a.index)
    .reduce((content, issue) => {
      return content.slice(0, issue.index) + issue.correct + content.slice(issue.index + issue.wrong.length);
    }, source);
}
