/**
 * Personalization settings page copy (Chinese product copy, English mirror).
 * The settings page registers under the `settings.personalization` locale
 * namespace; the framework delivers the bound `t` through the PropsLocale seat.
 */

/** Copy keys for the personalization settings page. */
export type PersonalizationKey =
  | 'nav'
  | 'master.title'
  | 'master.desc'
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
  | 'reset'
  | 'reset.confirm'
  | 'hint'

/** Chinese copy. */
export const zh: Record<PersonalizationKey, string> = {
  'nav': '个性化',
  'master.title': '启用个性化',
  'master.desc': '关闭后立即还原官方外观',
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
  'reset': '恢复默认设置',
  'reset.confirm': '确定恢复全部默认设置？',
  'hint': '配置保存在当前浏览器的 localStorage：重启 dsh 后仍然生效，但换浏览器或换电脑不会跟随。',
}

/** English copy. */
export const en: Record<PersonalizationKey, string> = {
  'nav': 'Personalization',
  'master.title': 'Enable personalization',
  'master.desc': 'Turning this off restores the official look immediately',
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
  'reset': 'Reset all settings',
  'reset.confirm': 'Reset everything to defaults?',
  'hint': 'Settings are saved in this browser\'s localStorage: they survive a dsh restart, but do not follow you to another browser or machine.',
}
