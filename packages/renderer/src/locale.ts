export interface GoalProgressMessages {
  readonly phasePaused: string;
  readonly phaseCompleted: string;
  readonly phaseUsageLimit: string;
  readonly phaseBudgetLimit: string;
  readonly phaseNativeGoalBlocked: string;
  readonly phaseDetached: string;
  readonly phaseFinalVerification: string;
  readonly phaseTracking: string;
  readonly statusCompletedVerified: string;
  readonly statusCompleted: string;
  readonly statusActive: string;
  readonly statusBlocked: string;
  readonly statusPending: string;
  readonly visibleSuccess: string;
  readonly visibleWorking: string;
  readonly visiblePending: string;
  readonly visibleBlocked: string;
  readonly visiblePaused: string;
  readonly current: string;
  readonly currentPaused: string;
  readonly currentBlocked: string;
  readonly goalCompleted: string;
  readonly waitingNativeGoalRecovery: string;
  readonly completionCount: (completed: number, total: number) => string;
  readonly placementSettingsTriggerLabel: string;
  readonly placementSettingsLabel: string;
  readonly displaySettings: string;
  readonly animationEffects: string;
  readonly fixedDisplay: string;
  readonly floatingDisplay: string;
  readonly overallLabel: string;
  readonly overallProgress: string;
  readonly composerShorterAutoExpand: string;
  readonly spaceRestoredAutoExpand: string;
  readonly expandProgress: string;
  readonly collapseProgress: string;
  readonly expand: string;
  readonly collapse: string;
  readonly floatingProgress: string;
  readonly objectiveList: string;
  readonly optionalObjectives: string;
  readonly optional: string;
  readonly emptyObjectives: string;
  readonly objectiveProgress: (title: string) => string;
  readonly scopeUpdated: (reason: string) => string;
  readonly progressCorrected: (reason: string) => string;
  readonly preparingReadGoal: string;
  readonly preparingBaseline: string;
  readonly preparingObjectives: string;
  readonly preparingCopy: string;
  readonly unavailableTitle: string;
  readonly unavailableCopy: string;
  readonly retryProgress: string;
  readonly retry: string;
  readonly closeProgress: string;
  readonly tokenUnavailable: string;
  readonly tokenInputOutput: (input: string, output: string) => string;
  readonly tokenTotal: (total: string) => string;
}

const zhCN: GoalProgressMessages = {
  phasePaused: "已暂停",
  phaseCompleted: "已完成",
  phaseUsageLimit: "额度限制",
  phaseBudgetLimit: "预算限制",
  phaseNativeGoalBlocked: "原生 Goal 受阻",
  phaseDetached: "已停止追踪",
  phaseFinalVerification: "等待最终验证",
  phaseTracking: "追踪中",
  statusCompletedVerified: "已完成并验证",
  statusCompleted: "已完成",
  statusActive: "正在进行",
  statusBlocked: "已阻塞",
  statusPending: "待做",
  visibleSuccess: "Success",
  visibleWorking: "Working",
  visiblePending: "Pending",
  visibleBlocked: "Blocked",
  visiblePaused: "Paused",
  current: "当前",
  currentPaused: "已暂停",
  currentBlocked: "受阻",
  goalCompleted: "目标已完成",
  waitingNativeGoalRecovery: "等待原生 Goal 恢复",
  completionCount: (completed, total) => `${completed}/${total} 个小目标完成`,
  placementSettingsTriggerLabel: "显示位置设置",
  placementSettingsLabel: "Goal Progress 显示设置",
  displaySettings: "显示设置",
  animationEffects: "动画效果",
  fixedDisplay: "固定显示",
  floatingDisplay: "浮动显示",
  overallLabel: "总进度",
  overallProgress: "总体进度",
  composerShorterAutoExpand: "输入框缩短后自动展开",
  spaceRestoredAutoExpand: "空间恢复后自动展开",
  expandProgress: "展开目标进度",
  collapseProgress: "收起目标进度",
  expand: "展开",
  collapse: "收起",
  floatingProgress: "漂浮进度，可左右拖动",
  objectiveList: "小目标列表",
  optionalObjectives: "可选验收点",
  optional: "可选",
  emptyObjectives: "还没有可显示的小目标",
  objectiveProgress: (title) => `${title}进度`,
  scopeUpdated: (reason) => `范围已更新：${reason}`,
  progressCorrected: (reason) => `进度已校正：${reason}`,
  preparingReadGoal: "正在读取当前目标…",
  preparingBaseline: "正在建立进度基线…",
  preparingObjectives: "正在准备专属验收点…",
  preparingCopy: "当前模型正在检查目标与验收清单。",
  unavailableTitle: "目标进度暂不可用",
  unavailableCopy: "Goal 可以继续工作。连接恢复后，进度会重新显示。",
  retryProgress: "重试进度",
  retry: "重试",
  closeProgress: "关闭进度",
  tokenUnavailable: "Token 暂不可用",
  tokenInputOutput: (input, output) => `输入 ${input} · 输出 ${output}`,
  tokenTotal: (total) => `Token ${total}`,
};

const en: GoalProgressMessages = {
  phasePaused: "Paused",
  phaseCompleted: "Completed",
  phaseUsageLimit: "Usage limit",
  phaseBudgetLimit: "Budget limit",
  phaseNativeGoalBlocked: "Native Goal blocked",
  phaseDetached: "Tracking stopped",
  phaseFinalVerification: "Awaiting final verification",
  phaseTracking: "Tracking",
  statusCompletedVerified: "Completed and verified",
  statusCompleted: "Completed",
  statusActive: "In progress",
  statusBlocked: "Blocked",
  statusPending: "Pending",
  visibleSuccess: "Success",
  visibleWorking: "Working",
  visiblePending: "Pending",
  visibleBlocked: "Blocked",
  visiblePaused: "Paused",
  current: "Current",
  currentPaused: "Paused",
  currentBlocked: "Blocked",
  goalCompleted: "Goal completed",
  waitingNativeGoalRecovery: "Waiting for the native Goal to resume",
  completionCount: (completed, total) => `${completed}/${total} objectives completed`,
  placementSettingsTriggerLabel: "Display position settings",
  placementSettingsLabel: "Goal Progress display settings",
  displaySettings: "Display settings",
  animationEffects: "Animation effects",
  fixedDisplay: "Fixed display",
  floatingDisplay: "Floating display",
  overallLabel: "Overall progress",
  overallProgress: "Overall progress",
  composerShorterAutoExpand: "Expands when the composer becomes shorter",
  spaceRestoredAutoExpand: "Expands when space is restored",
  expandProgress: "Expand Goal progress",
  collapseProgress: "Collapse Goal progress",
  expand: "Expand",
  collapse: "Collapse",
  floatingProgress: "Floating progress; drag left or right",
  objectiveList: "Objective list",
  optionalObjectives: "Optional acceptance points",
  optional: "Optional",
  emptyObjectives: "No objectives to display",
  objectiveProgress: (title) => `${title} progress`,
  scopeUpdated: (reason) => `Scope updated: ${reason}`,
  progressCorrected: (reason) => `Progress corrected: ${reason}`,
  preparingReadGoal: "Reading the current Goal…",
  preparingBaseline: "Establishing the progress baseline…",
  preparingObjectives: "Preparing acceptance points…",
  preparingCopy: "The current model is checking the Goal and acceptance checklist.",
  unavailableTitle: "Goal progress is unavailable",
  unavailableCopy: "The Goal can continue. Progress will return when the connection recovers.",
  retryProgress: "Retry progress",
  retry: "Retry",
  closeProgress: "Close progress",
  tokenUnavailable: "Token usage temporarily unavailable",
  tokenInputOutput: (input, output) => `Input ${input} · Output ${output}`,
  tokenTotal: (total) => `Token ${total}`,
};

const isIS: GoalProgressMessages = {
  phasePaused: "Í bið",
  phaseCompleted: "Lokið",
  phaseUsageLimit: "Notkunartakmörkun",
  phaseBudgetLimit: "Fjárhagsmörk",
  phaseNativeGoalBlocked: "Upprunalegt Goal er hindrað",
  phaseDetached: "Rakningu hætt",
  phaseFinalVerification: "Bíður lokastaðfestingar",
  phaseTracking: "Í rakningu",
  statusCompletedVerified: "Lokið og staðfest",
  statusCompleted: "Lokið",
  statusActive: "Í vinnslu",
  statusBlocked: "Hindrað",
  statusPending: "Í bið",
  visibleSuccess: "Lokið",
  visibleWorking: "Í vinnslu",
  visiblePending: "Í bið",
  visibleBlocked: "Hindrað",
  visiblePaused: "Í bið",
  current: "Núverandi",
  currentPaused: "Í bið",
  currentBlocked: "Hindrað",
  goalCompleted: "Markmiði lokið",
  waitingNativeGoalRecovery: "Bíður eftir að upprunalegt Goal haldi áfram",
  completionCount: (completed, total) => `${completed}/${total} undirmarkmiðum lokið`,
  placementSettingsTriggerLabel: "Stillingar skjástöðu",
  placementSettingsLabel: "Skjástillingar Goal Progress",
  displaySettings: "Skjástillingar",
  animationEffects: "Hreyfingar",
  fixedDisplay: "Föst sýn",
  floatingDisplay: "Fljótandi sýn",
  overallLabel: "Heildarframvinda",
  overallProgress: "Heildarframvinda",
  composerShorterAutoExpand: "Opnast þegar innsláttarsvæðið styttist",
  spaceRestoredAutoExpand: "Opnast þegar pláss losnar",
  expandProgress: "Stækka framvindu markmiðs",
  collapseProgress: "Fella framvindu markmiðs saman",
  expand: "Stækka",
  collapse: "Fella saman",
  floatingProgress: "Fljótandi framvinda; dragðu til vinstri eða hægri",
  objectiveList: "Listi undirmarkmiða",
  optionalObjectives: "Valfrjáls staðfestingaratriði",
  optional: "Valfrjálst",
  emptyObjectives: "Engin undirmarkmið til að sýna",
  objectiveProgress: (title) => `Framvinda: ${title}`,
  scopeUpdated: (reason) => `Umfang uppfært: ${reason}`,
  progressCorrected: (reason) => `Framvinda leiðrétt: ${reason}`,
  preparingReadGoal: "Les núverandi markmið…",
  preparingBaseline: "Stofnar framvindugrunn…",
  preparingObjectives: "Undirbýr staðfestingaratriði…",
  preparingCopy: "Núverandi líkan yfirfer markmiðið og gátlistann.",
  unavailableTitle: "Framvinda markmiðs er ekki tiltæk",
  unavailableCopy: "Goal getur haldið áfram. Framvindan birtist aftur þegar tengingin batnar.",
  retryProgress: "Reyna framvindu aftur",
  retry: "Reyna aftur",
  closeProgress: "Loka framvindu",
  tokenUnavailable: "Token-notkun er tímabundið ótiltæk",
  tokenInputOutput: (input, output) => `Inntak ${input} · Úttak ${output}`,
  tokenTotal: (total) => `Token ${total}`,
};

const ar: GoalProgressMessages = {
  phasePaused: "متوقف مؤقتًا",
  phaseCompleted: "مكتمل",
  phaseUsageLimit: "حد الاستخدام",
  phaseBudgetLimit: "حد الميزانية",
  phaseNativeGoalBlocked: "هدف Goal الأصلي متعذر",
  phaseDetached: "تم إيقاف التتبع",
  phaseFinalVerification: "بانتظار التحقق النهائي",
  phaseTracking: "قيد التتبع",
  statusCompletedVerified: "مكتمل وتم التحقق",
  statusCompleted: "مكتمل",
  statusActive: "قيد التنفيذ",
  statusBlocked: "متعذر",
  statusPending: "قيد الانتظار",
  visibleSuccess: "مكتمل",
  visibleWorking: "قيد العمل",
  visiblePending: "قيد الانتظار",
  visibleBlocked: "متعذر",
  visiblePaused: "متوقف مؤقتًا",
  current: "الحالي",
  currentPaused: "متوقف مؤقتًا",
  currentBlocked: "متعذر",
  goalCompleted: "اكتمل الهدف",
  waitingNativeGoalRecovery: "بانتظار استئناف هدف Goal الأصلي",
  completionCount: (completed, total) => `${completed}/${total} من الأهداف الفرعية مكتملة`,
  placementSettingsTriggerLabel: "إعدادات موضع العرض",
  placementSettingsLabel: "إعدادات عرض Goal Progress",
  displaySettings: "إعدادات العرض",
  animationEffects: "تأثيرات الحركة",
  fixedDisplay: "عرض ثابت",
  floatingDisplay: "عرض عائم",
  overallLabel: "التقدم الإجمالي",
  overallProgress: "التقدم الإجمالي",
  composerShorterAutoExpand: "يتمدد عند تقلص مربع الإدخال",
  spaceRestoredAutoExpand: "يتمدد عند توفر المساحة",
  expandProgress: "توسيع تقدم Goal",
  collapseProgress: "طي تقدم Goal",
  expand: "توسيع",
  collapse: "طي",
  floatingProgress: "تقدم عائم؛ اسحب يمينًا أو يسارًا",
  objectiveList: "قائمة الأهداف الفرعية",
  optionalObjectives: "نقاط قبول اختيارية",
  optional: "اختياري",
  emptyObjectives: "لا توجد أهداف فرعية لعرضها",
  objectiveProgress: (title) => `تقدم ${title}`,
  scopeUpdated: (reason) => `تم تحديث النطاق: ${reason}`,
  progressCorrected: (reason) => `تم تصحيح التقدم: ${reason}`,
  preparingReadGoal: "جارٍ قراءة الهدف الحالي…",
  preparingBaseline: "جارٍ إنشاء خط أساس للتقدم…",
  preparingObjectives: "جارٍ إعداد نقاط القبول…",
  preparingCopy: "يتحقق النموذج الحالي من الهدف وقائمة القبول.",
  unavailableTitle: "تقدم الهدف غير متاح",
  unavailableCopy: "يمكن أن يستمر Goal. سيظهر التقدم مجددًا بعد استعادة الاتصال.",
  retryProgress: "إعادة محاولة التقدم",
  retry: "إعادة المحاولة",
  closeProgress: "إغلاق التقدم",
  tokenUnavailable: "استخدام Token غير متاح مؤقتًا",
  tokenInputOutput: (input, output) => `إدخال ${input} · إخراج ${output}`,
  tokenTotal: (total) => `Token ${total}`,
};

const catalogs = new Map<string, GoalProgressMessages>([
  ["zh", zhCN],
  ["zh-CN", zhCN],
  ["zh-Hans", zhCN],
  ["en", en],
  ["is", isIS],
  ["is-IS", isIS],
  ["ar", ar],
]);

function canonicalLocale(rawLocale: string): string {
  const requested = rawLocale.trim();
  if (!requested) {
    return "en";
  }
  try {
    return Intl.getCanonicalLocales(requested)[0] ?? "en";
  } catch {
    return "en";
  }
}

export interface GoalProgressLocaleContext {
  readonly locale: string;
  readonly messages: GoalProgressMessages;
}

export function resolveGoalProgressLocale(rawLocale: string): GoalProgressLocaleContext {
  const locale = canonicalLocale(rawLocale);
  const parsedLocale = new Intl.Locale(locale);
  const language = parsedLocale.language;
  const messages =
    catalogs.get(locale) ??
    (language === "zh"
      ? parsedLocale.maximize().script === "Hans"
        ? zhCN
        : en
      : (catalogs.get(language) ?? en));
  return {
    locale,
    messages,
  };
}
