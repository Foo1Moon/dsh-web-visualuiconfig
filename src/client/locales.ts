/**
 * Personalization settings page copy (Chinese product copy, English mirror).
 * The settings page registers under the `settings.personalization` locale
 * namespace; the framework delivers the bound `t` through the PropsLocale seat.
 */

/** Copy keys for the personalization settings page. */
export type PersonalizationKey =
  | 'nav'
  | 'storage.title'
  | 'storage.desc'
  | 'storage.host'
  | 'storage.browser'
  | 'storage.hostUnavailable'
  | 'master.title'
  | 'master.desc'
  | 'theme.title'
  | 'theme.desc'
  | 'theme.empty'
  | 'theme.active'
  | 'theme.apply'
  | 'theme.deactivate'
  | 'theme.remove'
  | 'theme.removeConfirm'
  | 'theme.generate'
  | 'theme.generateBusy'
  | 'theme.generateHint'
  | 'theme.generateName'
  | 'theme.generateFailed'
  | 'theme.generatePreview'
  | 'theme.generateCancel'
  | 'theme.generatePass'
  | 'theme.generateFail'
  | 'theme.draftHint'
  | 'scope.title'
  | 'scope.desc'
  | 'scope.all'
  | 'scope.resetPanel'
  | 'scope.followAll'
  | 'scope.followAll.desc'
  | 'follow.label'
  | 'panel.sidebar'
  | 'panel.conversation'
  | 'panel.details'
  | 'panel.aionui'
  | 'panel.taskboard'
  | 'panel.ssh'
  | 'background.title'
  | 'background.upload'
  | 'background.remove'
  | 'background.scrim'
  | 'background.solid'
  | 'background.independentHint'
  | 'background.mode.solid'
  | 'background.mode.image'
  | 'background.fit'
  | 'background.fit.cover'
  | 'background.fit.contain'
  | 'background.fit.stretch'
  | 'background.fit.tile'
  | 'background.blur'
  | 'globalBackground.title'
  | 'globalBackground.desc'
  | 'glass.title'
  | 'glass.desc'
  | 'glass.opacity'
  | 'glass.solidHint'
  | 'palette.title'
  | 'palette.custom'
  | 'palette.none'
  | 'font.title'
  | 'font.custom'
  | 'scrollbar.title'
  | 'scrollbar.desc'
  | 'scrollbar.enable'
  | 'selection.title'
  | 'selection.clear'
  | 'chrome.title'
  | 'chrome.favicon'
  | 'chrome.faviconUpload'
  | 'chrome.faviconRemove'
  | 'chrome.titleLabel'
  | 'chrome.titleClear'
  | 'chrome.statusLabel'
  | 'chrome.statusPlaceholder'
  | 'chrome.statusClear'
  | 'reset'
  | 'reset.confirm'
  | 'hint'

/** Chinese copy. */
export const zh: Record<PersonalizationKey, string> = {
  'nav': '个性化',
  'storage.title': '配置存储',
  'storage.desc': '默认保存到本机（~/.dsh 文件），换浏览器或电脑仍然生效；可切换为仅保存在当前浏览器',
  'storage.host': '跟随本机',
  'storage.browser': '仅此浏览器',
  'storage.hostUnavailable': '主机存储当前不可用（插件宿主侧可能尚未加载，请重启 dsh web），已临时回退为仅保存在当前浏览器',
  'master.title': '启用个性化',
  'master.desc': '关闭后立即还原官方外观',
  'theme.title': '角色主题',
  'theme.desc': '由角色图 + 介绍生成的主题库，同一时刻至多一个生效；关闭后还原启用前的外观',
  'theme.empty': '还没有角色主题。可以上传角色图自动生成，或在对话里给 agent 一张角色图和一段介绍（例如「用这张图做一个芙莉莲主题」）',
  'theme.active': '当前生效',
  'theme.apply': '应用',
  'theme.deactivate': '关闭主题',
  'theme.remove': '删除',
  'theme.removeConfirm': '删除角色主题「{name}」？',
  'theme.generate': '从角色图生成',
  'theme.generateBusy': '生成中…',
  'theme.generateHint': '上传一张角色图，浏览器自动提取主色并保对比度推导整套配色；先预览方案，确认满意后再应用（原图不出本机）',
  'theme.generateName': '主题名称',
  'theme.generateFailed': '生成失败：',
  'theme.generatePreview': '生成方案预览',
  'theme.generateCancel': '取消',
  'theme.generatePass': '可读性校验通过',
  'theme.generateFail': '可读性校验未通过',
  'theme.draftHint': '这是提取出的配色方案，尚未应用——确认满意后再点击「应用」',
  'scope.title': '编辑目标',
  'scope.desc': '默认「全部面板」统一调整；也可选择某个面板单独调整它的个性化内容',
  'scope.all': '全部面板',
  'scope.resetPanel': '恢复该面板默认',
  'scope.followAll': '全部跟随主题',
  'scope.followAll.desc': '该面板所有参数跟随「全部面板」，不可单独编辑',
  'follow.label': '跟随主题',
  'panel.sidebar': '侧边栏',
  'panel.conversation': '对话区',
  'panel.details': '详情区',
  'panel.aionui': '右侧文件/预览面板（aionui）',
  'panel.taskboard': '任务面板',
  'panel.ssh': 'SSH 面板',
  'background.title': '背景设置',
  'background.upload': '选择图片',
  'background.remove': '移除',
  'background.scrim': '遮罩浓度',
  'background.solid': '面板显示纯色背景（透明度仍可调节半透明效果）',
  'background.independentHint': '{n} 个面板的背景为独立状态，未跟随此图；勾选「跟随主题」可全部应用',
  'background.mode.solid': '纯色背景',
  'background.mode.image': '背景图',
  'background.fit': '显示方式',
  'background.fit.cover': '铺满',
  'background.fit.contain': '完整显示',
  'background.fit.stretch': '拉伸',
  'background.fit.tile': '平铺',
  'background.blur': '模糊（全局背景）',
  'globalBackground.title': '全局背景',
  'globalBackground.desc': '整页底层背景图，与各面板背景独立；面板未设置自己的背景图时会透出它',
  'glass.title': '面板透明度',
  'glass.desc': '数值越高面板越透明，背景图越透出；0 = 不透明（背景图被面板完全遮住）',
  'glass.opacity': '透明度',
  'glass.solidHint': '当前为纯色背景，透明度效果较微弱；切换「背景图」后调节效果更明显',
  'palette.title': '主题色',
  'palette.custom': '自定义',
  'palette.none': '跟随官方',
  'font.title': '字体',
  'font.custom': '自定义字体栈（CSS font-family）',
  'scrollbar.title': '自定义滚动条',
  'scrollbar.desc': '圆角滚动条，跟随主题色',
  'scrollbar.enable': '启用',
  'selection.title': '选中文字颜色',
  'selection.clear': '恢复默认',
  'chrome.title': '页面外观',
  'chrome.favicon': '收藏夹图标',
  'chrome.faviconUpload': '上传图标',
  'chrome.faviconRemove': '移除',
  'chrome.titleLabel': '页面标题',
  'chrome.titleClear': '清除',
  'chrome.statusLabel': '运行状态文案',
  'chrome.statusPlaceholder': 'Deep diving...（默认）',
  'chrome.statusClear': '恢复默认',
  'reset': '恢复默认设置',
  'reset.confirm': '确定恢复全部默认设置？',
  'hint': '配置默认跟随本机（存于 ~/.dsh/dsh-web-personalization.json），重启 dsh 或换浏览器仍然生效；可在上方切换为仅保存在当前浏览器。',
}

/** English copy. */
export const en: Record<PersonalizationKey, string> = {
  'nav': 'Personalization',
  'storage.title': 'Config storage',
  'storage.desc': 'Defaults to this machine (~/.dsh file) and follows you across browsers; switch to keep it in this browser only',
  'storage.host': 'Follow this machine',
  'storage.browser': 'This browser only',
  'storage.hostUnavailable': 'Host storage is unavailable right now (the plugin host half may not be loaded; restart dsh web), temporarily falling back to this browser only',
  'master.title': 'Enable personalization',
  'master.desc': 'Turning this off restores the official look immediately',
  'theme.title': 'Character themes',
  'theme.desc': 'Themes generated from character art + introduction; at most one is active at a time — turning it off restores the pre-theme look',
  'theme.empty': 'No character themes yet. Upload a character image below to generate one, or give the agent an image and a short introduction in chat (e.g. "build a Frieren theme from this image")',
  'theme.active': 'Active',
  'theme.apply': 'Apply',
  'theme.deactivate': 'Turn off',
  'theme.remove': 'Delete',
  'theme.removeConfirm': 'Delete character theme "{name}"?',
  'theme.generate': 'Generate from image',
  'theme.generateBusy': 'Generating…',
  'theme.generateHint': 'Upload a character image; the browser extracts the palette and derives the whole contrast-preserving ramp locally. You get a preview first — confirm it before it is applied (the image never leaves this machine)',
  'theme.generateName': 'Theme name',
  'theme.generateFailed': 'Generation failed: ',
  'theme.generatePreview': 'Generated scheme preview',
  'theme.generateCancel': 'Cancel',
  'theme.generatePass': 'Contrast check passed',
  'theme.generateFail': 'Contrast check failed',
  'theme.draftHint': 'This is the extracted palette — nothing has been applied yet. Confirm it looks right, then click Apply.',
  'scope.title': 'Edit target',
  'scope.desc': 'Default is "all panels" adjusted uniformly; pick one panel to restyle it independently',
  'scope.all': 'All panels',
  'scope.resetPanel': 'Reset this panel',
  'scope.followAll': 'Follow all',
  'scope.followAll.desc': 'Every knob of this panel follows the "all panels" baseline and is not editable',
  'follow.label': 'Follow theme',
  'panel.sidebar': 'Sidebar',
  'panel.conversation': 'Conversation',
  'panel.details': 'Details',
  'panel.aionui': 'Right-side file/preview panel (aionui)',
  'panel.taskboard': 'Task board',
  'panel.ssh': 'SSH panel',
  'background.title': 'Background settings',
  'background.upload': 'Choose image',
  'background.remove': 'Remove',
  'background.scrim': 'Scrim strength',
  'background.solid': 'The panel shows its solid base color (transparency still applies)',
  'background.independentHint': '{n} panel(s) have an independent background and do not follow this image; tick "Follow theme" to apply to all',
  'background.mode.solid': 'Solid color',
  'background.mode.image': 'Image',
  'background.fit': 'Fit',
  'background.fit.cover': 'Cover',
  'background.fit.contain': 'Contain',
  'background.fit.stretch': 'Stretch',
  'background.fit.tile': 'Tile',
  'background.blur': 'Blur (global backdrop)',
  'globalBackground.title': 'Global background',
  'globalBackground.desc': 'Page-wide bottom-layer backdrop, independent of panel backgrounds; panels without their own image show it through',
  'glass.title': 'Panel transparency',
  'glass.desc': 'Higher = panels more transparent, backdrop shows through; 0 = opaque (the background is fully covered by panels)',
  'glass.opacity': 'Transparency',
  'glass.solidHint': 'Solid background: transparency has little visible effect; switch to an image background for a clear result',
  'palette.title': 'Accent color',
  'palette.custom': 'Custom',
  'palette.none': 'Official',
  'font.title': 'Typography',
  'font.custom': 'Custom font stack (CSS font-family)',
  'scrollbar.title': 'Custom scrollbar',
  'scrollbar.desc': 'Rounded scrollbar that follows the accent',
  'scrollbar.enable': 'Enable',
  'selection.title': 'Text selection color',
  'selection.clear': 'Reset',
  'chrome.title': 'Page chrome',
  'chrome.favicon': 'Favicon',
  'chrome.faviconUpload': 'Upload icon',
  'chrome.faviconRemove': 'Remove',
  'chrome.titleLabel': 'Page title',
  'chrome.titleClear': 'Clear',
  'chrome.statusLabel': 'Running status text',
  'chrome.statusPlaceholder': 'Deep diving... (default)',
  'chrome.statusClear': 'Reset',
  'reset': 'Reset all settings',
  'reset.confirm': 'Reset everything to defaults?',
  'hint': 'Settings follow this machine by default (~/.dsh/dsh-web-personalization.json): they survive a dsh restart and follow you to another browser. Use the switch above to keep them in this browser only.',
}
