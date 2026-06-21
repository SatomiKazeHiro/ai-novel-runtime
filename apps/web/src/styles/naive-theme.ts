/**
 * Naive UI themeOverrides —— light 与 dark 双套, 共用形状.
 *
 * 设计原则:
 *   1) lightOverrides 是 boords 风格的完整定制 (从 App.vue 搬过来, 不丢任何字段).
 *   2) darkOverrides = { ...lightOverrides, common/Card/... } 只覆盖需要翻的面板/文字/边框.
 *      品牌色 (terracotta / blueprint / sage / red / purple) 和大多数 primary 状态
 *      在 dark 模式下保持一致 —— 只是 surface/text/border 反相.
 *   3) 颜色都从 './tokens' 读, 任何 hex 改动必须同步改 tokens.ts + tokens.css.
 *   4) 加新组件: 先在 lightOverrides 加全字段; 在 darkOverrides 里 spread + 改需要翻的字段.
 *      不要复制 lightOverrides 整个对象重写 —— 用 spread.
 *
 * 颜色逻辑与 spec "5.1 抽 naive-theme.ts + 改 App.vue 接入层" 一致.
 */
import type { GlobalThemeOverrides } from 'naive-ui'
import { COLOR } from './tokens'

const COMMON_FONT_FAMILY = "'DM Sans', 'matter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Helvetica Neue', Arial, sans-serif"
const COMMON_FONT_FAMILY_MONO = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

/* ============================================================
   Light overrides —— 完整 boords 风格
   ============================================================ */
export const lightOverrides: GlobalThemeOverrides = {
  /* === Common: brand palette + typography + surfaces + radius === */
  common: {
    primaryColor: COLOR.warmAccent,
    primaryColorHover: COLOR.warmAccentHover,
    primaryColorPressed: COLOR.warmAccentPressed,
    primaryColorSuppl: COLOR.warmAccent,
    infoColor: COLOR.coolAccent,
    infoColorHover: COLOR.coolAccentHover,
    infoColorPressed: COLOR.coolAccentPressed,
    successColor: COLOR.positive,
    successColorHover: COLOR.positiveHover,
    successColorPressed: COLOR.positivePressed,
    warningColor: COLOR.warmAccent,
    warningColorHover: COLOR.warmAccentHover,
    warningColorPressed: COLOR.warmAccentPressed,
    errorColor: COLOR.error,
    errorColorHover: COLOR.errorHover,
    errorColorPressed: COLOR.errorPressed,

    bodyColor: COLOR.warmCream,
    cardColor: COLOR.pureWhite,
    modalColor: COLOR.pureWhite,
    popoverColor: COLOR.pureWhite,
    tableColor: COLOR.pureWhite,
    inputColor: COLOR.pureWhite,
    actionColor: COLOR.stoneGray,
    tableHeaderColor: COLOR.stoneGray,
    tagColor: COLOR.stoneGray,

    borderColor: COLOR.pebbleBorder,
    dividerColor: COLOR.pebbleBorder,

    textColorBase: COLOR.inkBlack,
    textColor1: COLOR.inkBlack,
    textColor2: COLOR.graphite,
    textColor3: COLOR.midGray,
    textColorDisabled: COLOR.textDisabled,
    placeholderColor: COLOR.placeholder,
    placeholderColorDisabled: COLOR.placeholderDisabled,
    iconColor: COLOR.graphite,
    iconColorHover: COLOR.inkBlack,
    iconColorPressed: COLOR.inkBlack,
    iconColorDisabled: COLOR.textDisabled,

    fontFamily: COMMON_FONT_FAMILY,
    fontFamilyMono: COMMON_FONT_FAMILY_MONO,
    fontWeight: '400',
    fontWeightStrong: '600',

    borderRadius: '6px',
    borderRadiusSmall: '6px',
    boxShadow1: `0 1px 2px ${COLOR.shadowLight}`,
    boxShadow2: `0 4px 14px ${COLOR.shadowMedium}, 0 1px 3px ${COLOR.shadowLight}`,
    boxShadow3: `0 8px 24px ${COLOR.shadowStrong}, 0 2px 6px ${COLOR.shadowLight}`
  },

  /* === Button: terracotta primary, white default, 6px radius, no shadows === */
  Button: {
    borderRadiusMedium: '6px',
    borderRadiusSmall: '6px',
    borderRadiusLarge: '6px',
    heightMedium: '36px',
    heightSmall: '28px',
    heightLarge: '44px',
    heightTiny: '22px',
    paddingMedium: '0 20px',
    paddingSmall: '0 14px',
    paddingLarge: '0 24px',
    paddingTiny: '0 10px',
    fontSizeTiny: '12px',
    fontSizeSmall: '13px',
    fontSizeMedium: '14px',
    fontSizeLarge: '16px',
    fontWeight: '500',
    textColor: COLOR.inkBlack,
    textColorHover: COLOR.inkBlack,
    textColorPressed: COLOR.inkBlack,
    textColorFocus: COLOR.inkBlack,
    color: COLOR.pureWhite,
    colorHover: COLOR.stoneGray,
    colorPressed: COLOR.stoneGrayPressed,
    colorFocus: COLOR.pureWhite,
    border: `1px solid ${COLOR.pebbleBorder}`,
    borderHover: `1px solid ${COLOR.midGray}`,
    borderPressed: `1px solid ${COLOR.graphite}`,
    borderFocus: `1px solid ${COLOR.coolAccent}`,
    textColorPrimary: COLOR.pureWhite,
    textColorHoverPrimary: COLOR.pureWhite,
    textColorPressedPrimary: COLOR.pureWhite,
    textColorFocusPrimary: COLOR.pureWhite,
    colorPrimary: COLOR.warmAccent,
    colorHoverPrimary: COLOR.warmAccentHover,
    colorPressedPrimary: COLOR.warmAccentPressed,
    colorFocusPrimary: COLOR.warmAccentHover,
    borderPrimary: `1px solid ${COLOR.warmAccent}`,
    borderHoverPrimary: `1px solid ${COLOR.warmAccentHover}`,
    borderPressedPrimary: `1px solid ${COLOR.warmAccentPressed}`,
    borderFocusPrimary: `1px solid ${COLOR.warmAccentHover}`,
    textColorInfo: COLOR.coolAccent,
    textColorHoverInfo: COLOR.coolAccentHover,
    textColorPressedInfo: COLOR.coolAccentPressed,
    colorInfo: COLOR.pureWhite,
    colorHoverInfo: COLOR.coolAccentTintLight,
    colorPressedInfo: COLOR.coolAccentTintPressed,
    borderInfo: `1px solid ${COLOR.coolAccent}`,
    borderHoverInfo: `1px solid ${COLOR.coolAccentHover}`,
    borderPressedInfo: `1px solid ${COLOR.coolAccentPressed}`,
    textColorSuccess: COLOR.pureWhite,
    textColorHoverSuccess: COLOR.pureWhite,
    textColorPressedSuccess: COLOR.pureWhite,
    colorSuccess: COLOR.positive,
    colorHoverSuccess: COLOR.positiveHover,
    colorPressedSuccess: COLOR.positivePressed,
    borderSuccess: `1px solid ${COLOR.positive}`,
    borderHoverSuccess: `1px solid ${COLOR.positiveHover}`,
    borderPressedSuccess: `1px solid ${COLOR.positivePressed}`,
    textColorWarning: COLOR.pureWhite,
    textColorHoverWarning: COLOR.pureWhite,
    textColorPressedWarning: COLOR.pureWhite,
    colorWarning: COLOR.warmAccentTint,
    colorHoverWarning: COLOR.warmAccentTintHover,
    colorPressedWarning: COLOR.warmAccentTintPressed,
    borderWarning: `1px solid ${COLOR.warmAccent}`,
    borderHoverWarning: `1px solid ${COLOR.warmAccentHover}`,
    borderPressedWarning: `1px solid ${COLOR.warmAccentPressed}`,
    textColorError: COLOR.error,
    textColorHoverError: COLOR.errorHover,
    textColorPressedError: COLOR.errorPressed,
    colorError: COLOR.pureWhite,
    colorHoverError: COLOR.errorTintLight,
    colorPressedError: COLOR.errorTintPressed,
    colorFocusError: COLOR.errorTintFocus,
    borderError: `1px solid ${COLOR.pebbleBorder}`,
    borderHoverError: `1px solid ${COLOR.error}`,
    borderPressedError: `1px solid ${COLOR.errorPressed}`,
    borderFocusError: `1px solid ${COLOR.error}`,
    textColorText: COLOR.coolAccent,
    textColorTextHover: COLOR.coolAccentHover,
    textColorTextPressed: COLOR.coolAccentPressed,
    textColorTextFocus: COLOR.coolAccentHover,
    colorText: 'transparent',
    colorTextHover: 'transparent',
    colorTextPressed: 'transparent',
    colorTextFocus: 'transparent',
    borderText: '0 solid transparent',
    borderTextHover: '0 solid transparent',
    borderTextPressed: '0 solid transparent',
    borderTextFocus: '0 solid transparent',
    waveOpacity: '0'
  },

  /* === Card: white, 1px pebble border, 6px radius, no shadow === */
  Card: {
    borderRadius: '6px',
    color: COLOR.pureWhite,
    colorEmbedded: COLOR.warmCream,
    borderColor: COLOR.pebbleBorder,
    titleTextColor: COLOR.inkBlack,
    titleFontWeight: '600',
    titleFontSize: '16px',
    paddingMedium: '20px 24px',
    paddingLarge: '28px 32px',
    paddingSmall: '14px 18px',
    actionPaddingMedium: '0 24px 20px 24px',
    closeColor: COLOR.midGray,
    closeColorHover: COLOR.inkBlack,
    closeColorPressed: COLOR.inkBlack
  },

  /* === Tag: 6px radius, semantic variants === */
  Tag: {
    borderRadius: '6px',
    fontWeightStrong: '600',
    fontSizeTiny: '12px',
    fontSizeSmall: '12px',
    fontSizeMedium: '12px',
    paddingTiny: '0 10px',
    paddingSmall: '0 10px',
    paddingMedium: '0 10px',
    color: COLOR.stoneGray,
    textColor: COLOR.inkBlack,
    border: `1px solid ${COLOR.pebbleBorder}`,
    colorInfo: COLOR.infoTint,
    textColorInfo: COLOR.coolAccent,
    borderInfo: '1px solid transparent',
    colorSuccess: COLOR.positiveTint,
    textColorSuccess: COLOR.positive,
    borderSuccess: '1px solid transparent',
    colorWarning: COLOR.warmAccentTint,
    textColorWarning: COLOR.warmAccent,
    borderWarning: '1px solid transparent',
    colorError: COLOR.errorTint,
    textColorError: COLOR.error,
    borderError: '1px solid transparent'
  },

  /* === Input: 1px pebble, focus = terracotta ring, white fill === */
  Input: {
    borderRadius: '6px',
    border: `1px solid ${COLOR.pebbleBorder}`,
    borderHover: `1px solid ${COLOR.midGray}`,
    borderFocus: `1px solid ${COLOR.warmAccent}`,
    boxShadowFocus: `0 0 0 1px ${COLOR.focusRing}`,
    color: COLOR.pureWhite,
    colorFocus: COLOR.pureWhite,
    textColor: COLOR.inkBlack,
    placeholderColor: COLOR.placeholder,
    caretColor: COLOR.warmAccent,
    heightMedium: '36px',
    heightSmall: '28px',
    heightLarge: '40px',
    paddingMedium: '0 12px',
    fontSizeMedium: '14px',
    fontSizeSmall: '13px',
    borderDisabled: `1px solid ${COLOR.stoneGray}`,
    colorDisabled: COLOR.stoneGray,
    textColorDisabled: COLOR.textDisabled
  },

  /* === Select: white + 1px pebble + terracotta focus; menu = white with selected = blueprint text === */
  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '6px',
        border: `1px solid ${COLOR.pebbleBorder}`,
        borderHover: `1px solid ${COLOR.midGray}`,
        borderFocus: `1px solid ${COLOR.warmAccent}`,
        boxShadowFocus: `0 0 0 1px ${COLOR.focusRing}`,
        color: COLOR.pureWhite,
        textColor: COLOR.inkBlack,
        placeholderColor: COLOR.placeholder,
        caretColor: COLOR.warmAccent,
        heightMedium: '36px',
        heightSmall: '30px',
        heightLarge: '40px',
        fontSizeMedium: '14px',
        fontSizeSmall: '13px',
        colorDisabled: COLOR.stoneGray,
        textColorDisabled: COLOR.textDisabled
      },
      InternalSelectMenu: {
        borderRadius: '6px',
        color: COLOR.pureWhite,
        optionTextColor: COLOR.inkBlack,
        optionColorPending: COLOR.warmCream,
        optionColorActive: COLOR.warmCream,
        optionColorActivePending: COLOR.warmCream,
        optionTextColorActive: COLOR.coolAccent,
        optionCheckColor: COLOR.coolAccent,
        optionHeightMedium: '34px'
      }
    }
  },

  /* === DataTable: 1px pebble separators, stone-gray th, white td === */
  DataTable: {
    borderRadius: '6px',
    borderColor: COLOR.pebbleBorder,
    thColor: COLOR.stoneGray,
    thColorHover: COLOR.stoneGrayPressed,
    thColorActive: COLOR.stoneGrayPressed,
    tdColor: COLOR.pureWhite,
    tdColorHover: COLOR.warmCream,
    tdColorStriped: COLOR.warmCream,
    thTextColor: COLOR.midGray,
    tdTextColor: COLOR.inkBlack,
    thFontWeight: '600',
    fontSize: '14px',
    thPaddingMedium: '12px 16px',
    thPaddingSmall: '10px 12px',
    thPaddingLarge: '14px 18px',
    tdPaddingMedium: '14px 16px',
    tdPaddingSmall: '12px 12px',
    tdPaddingLarge: '16px 18px',
    borderColorModal: COLOR.pebbleBorder,
    thBorderColor: COLOR.pebbleBorder,
    tdBorderColor: COLOR.pebbleBorder
  },

  /* === Menu: active = blueprint, no fill === */
  Menu: {
    borderRadius: '6px',
    color: 'transparent',
    borderColor: 'transparent',
    itemTextColor: COLOR.graphite,
    itemTextColorHover: COLOR.inkBlack,
    itemTextColorActive: COLOR.coolAccent,
    itemTextColorActiveHover: COLOR.coolAccent,
    itemTextColorActiveCollapsed: COLOR.coolAccent,
    itemTextColorChildActive: COLOR.coolAccent,
    itemTextColorChildActiveHover: COLOR.coolAccent,
    itemIconColor: COLOR.graphite,
    itemIconColorHover: COLOR.inkBlack,
    itemIconColorActive: COLOR.coolAccent,
    itemIconColorActiveHover: COLOR.coolAccent,
    itemIconColorActiveCollapsed: COLOR.coolAccent,
    itemIconColorChildActive: COLOR.coolAccent,
    itemIconColorChildActiveHover: COLOR.coolAccent,
    itemColorHover: COLOR.stoneGray,
    itemColorActive: 'transparent',
    itemColorActiveHover: COLOR.stoneGray,
    itemColorActiveCollapsed: 'transparent',
    itemColorChildActive: 'transparent',
    itemColorChildActiveHover: COLOR.stoneGray,
    fontWeightActive: '500',
    fontWeightActiveCollapsed: '500',
    arrowColor: COLOR.midGray,
    arrowColorHover: COLOR.inkBlack,
    arrowColorActive: COLOR.coolAccent,
    arrowColorActiveHover: COLOR.coolAccent,
    arrowColorChildActive: COLOR.coolAccent,
    arrowColorChildActiveHover: COLOR.coolAccent
  },

  /* === Layout: cream body, white sider, 1px pebble borders === */
  Layout: {
    color: COLOR.warmCream,
    siderColor: COLOR.pureWhite,
    siderBorderColor: COLOR.pebbleBorder,
    siderToggleButtonColor: COLOR.pureWhite,
    siderToggleButtonBorderColor: COLOR.pebbleBorder,
    headerColor: COLOR.warmCream,
    headerBorderColor: COLOR.pebbleBorder,
    footerColor: COLOR.warmCream,
    footerBorderColor: COLOR.pebbleBorder,
    bodyColor: COLOR.warmCream
  },

  /* === Modal: white card, no shadow === */
  Modal: { color: COLOR.pureWhite },

  /* === Dialog: 6px radius, 1px pebble border === */
  Dialog: {
    color: COLOR.pureWhite,
    borderRadius: '6px',
    border: `1px solid ${COLOR.pebbleBorder}`,
    titleTextColor: COLOR.inkBlack,
    titleFontWeight: '600',
    paddingMedium: '20px 24px',
    paddingLarge: '28px 32px',
    iconColorInfo: COLOR.coolAccent,
    iconColorSuccess: COLOR.positive,
    iconColorWarning: COLOR.warmAccent,
    iconColorError: COLOR.error
  },

  /* === Alert: flat, semantic-tinted backgrounds === */
  Alert: {
    color: COLOR.pureWhite,
    colorInfo: COLOR.infoTint,
    colorSuccess: COLOR.positiveTint,
    colorWarning: COLOR.warmAccentTint,
    colorError: COLOR.errorTint10,
    textColor: COLOR.inkBlack,
    textColorInfo: COLOR.coolAccent,
    textColorSuccess: COLOR.positive,
    textColorWarning: COLOR.warmAccent,
    textColorError: COLOR.error,
    borderRadius: '6px',
    border: '1px solid transparent',
    borderInfo: '1px solid transparent',
    borderSuccess: '1px solid transparent',
    borderWarning: '1px solid transparent',
    borderError: '1px solid transparent',
    iconColorInfo: COLOR.coolAccent,
    iconColorSuccess: COLOR.positive,
    iconColorWarning: COLOR.warmAccent,
    iconColorError: COLOR.error,
    fontSize: '13px',
    paddingMedium: '14px 18px'
  },

  /* === Divider: pebble === */
  Divider: {
    color: COLOR.pebbleBorder,
    textColor: COLOR.midGray,
    fontWeight: '500'
  },

  /* === Switch: rail = terracotta when active === */
  Switch: {
    railColor: COLOR.stoneGray,
    railColorActive: COLOR.warmAccent,
    buttonColor: COLOR.pureWhite,
    buttonColorActive: COLOR.pureWhite,
    boxShadow: `0 0 0 1px ${COLOR.pebbleBorder}`,
    boxShadowActive: `0 0 0 1px ${COLOR.coolAccent}`,
    height: '22px',
    width: '40px',
    buttonBoxShadow: `0 2px 4px 0 ${COLOR.shadowButton}`
  },

  /* === Empty: dim icon + tertiary description === */
  Empty: {
    textColor: COLOR.midGray,
    iconColor: COLOR.pebbleBorder,
    fontSize: '13px',
    padding: '32px 0'
  },

  /* === Spin: terracotta spinner === */
  Spin: {
    color: COLOR.warmAccent,
    textColor: COLOR.graphite,
    fontSize: '14px'
  },

  /* === Statistic: ink value, eyebrow-style label === */
  Statistic: {
    valueTextColor: COLOR.inkBlack,
    valueFontWeight: '600',
    valueFontSizeMedium: '32px',
    valueFontSizeLarge: '40px',
    valueFontSizeHuge: '48px',
    labelTextColor: COLOR.midGray,
    labelFontSize: '11px',
    labelFontWeight: '600'
  },

  /* === Tabs: terracotta underline bar, ink active text === */
  Tabs: {
    tabTextColor: COLOR.graphite,
    tabTextColorActive: COLOR.inkBlack,
    tabTextColorHover: COLOR.inkBlack,
    tabFontWeightActive: '600',
    tabFontWeight: '400',
    barColor: COLOR.warmAccent,
    tabGapMedium: '24px',
    tabGapSmall: '16px',
    tabGapLarge: '32px',
    tabPaddingMedium: '8px 0',
    tabPaddingSmall: '6px 0',
    tabPaddingLarge: '12px 0',
    navColor: 'transparent',
    barColorActive: 'transparent',
    barColorActivePrimary: COLOR.warmAccent
  },

  /* === Form: medium weight label === */
  Form: {
    labelTextColor: COLOR.inkBlack,
    labelFontSize: '14px',
    labelFontWeight: '500',
    labelHeight: '34px',
    feedbackTextColorError: COLOR.error,
    feedbackTextColorWarning: COLOR.warmAccent,
    feedbackTextColorInfo: COLOR.coolAccent,
    feedbackFontSize: '12px',
    asteriskColor: COLOR.error
  },

  /* === Slider: terracotta fill === */
  Slider: {
    fillColor: COLOR.warmAccent,
    fillColorHover: COLOR.warmAccentHover,
    fillColorPressed: COLOR.warmAccentPressed,
    handleColor: COLOR.warmAccent,
    handleColorHover: COLOR.warmAccentHover,
    handleColorPressed: COLOR.warmAccentPressed,
    railColor: COLOR.stoneGray,
    railColorHover: COLOR.stoneGrayPressed,
    railColorPressed: COLOR.stoneGrayPressed,
    handleBoxShadow: `0 0 0 1px ${COLOR.pebbleBorder}`,
    handleBoxShadowHover: `0 0 0 1px ${COLOR.warmAccent}`,
    handleBoxShadowPressed: `0 0 0 1px ${COLOR.warmAccent}`,
    handleBoxShadowFocus: `0 0 0 1px ${COLOR.warmAccent}`,
    indicatorTextColor: COLOR.pureWhite,
    indicatorColor: COLOR.inkBlack,
    fontSize: '12px'
  },

  /* === Collapse: flat header, no shadow === */
  Collapse: {
    borderRadius: '6px',
    fontSize: '14px',
    headerFontSize: '14px',
    headerFontWeight: '500',
    headerTextColor: COLOR.inkBlack,
    headerTextColorHover: COLOR.coolAccent,
    headerTextColorActive: COLOR.coolAccent,
    headerIconColor: COLOR.midGray,
    headerIconColorHover: COLOR.inkBlack,
    headerIconColorActive: COLOR.coolAccent,
    titlePaddingMedium: '10px 14px',
    bodyPaddingMedium: '0 14px 14px 14px',
    dividerColor: COLOR.pebbleBorder
  },

  /* === Descriptions: pebble separators, eyebrow label === */
  Descriptions: {
    thColor: 'transparent',
    thTextColor: COLOR.midGray,
    thFontWeight: '600',
    thPaddingMedium: '12px 16px',
    thPaddingSmall: '10px 12px',
    thPaddingLarge: '14px 18px',
    tdColor: 'transparent',
    tdTextColor: COLOR.inkBlack,
    tdPaddingMedium: '12px 16px',
    tdPaddingSmall: '10px 12px',
    tdPaddingLarge: '16px 18px',
    borderColor: COLOR.pebbleBorder
  },

  /* === Skeleton: pebble-toned placeholder === */
  Skeleton: {
    color: COLOR.stoneGray,
    colorEnd: COLOR.skeletonEnd,
    colorActive: COLOR.coolAccentTintLight,
    borderRadius: '6px'
  },

  /* === LoadingBar: terracotta progress === */
  LoadingBar: {
    colorError: COLOR.error,
    colorInfo: COLOR.coolAccent,
    colorLoading: COLOR.warmAccent,
    colorSuccess: COLOR.positive,
    colorWarning: COLOR.warmAccent,
    height: '2px'
  },

  /* === Notification: white card, 1px pebble === */
  Notification: {
    color: COLOR.pureWhite,
    borderRadius: '6px',
    border: `1px solid ${COLOR.pebbleBorder}`,
    titleTextColor: COLOR.inkBlack,
    titleFontWeight: '600',
    metaTextColor: COLOR.midGray,
    contentTextColor: COLOR.graphite,
    iconColorInfo: COLOR.coolAccent,
    iconColorSuccess: COLOR.positive,
    iconColorWarning: COLOR.warmAccent,
    iconColorError: COLOR.error,
    boxShadow: 'none'
  },

  /* === Message: white pill, 1px pebble === */
  Message: {
    colorInfo: COLOR.pureWhite,
    colorSuccess: COLOR.pureWhite,
    colorWarning: COLOR.pureWhite,
    colorError: COLOR.pureWhite,
    textColorInfo: COLOR.coolAccent,
    textColorSuccess: COLOR.positive,
    textColorWarning: COLOR.warmAccent,
    textColorError: COLOR.error,
    borderRadius: '6px',
    border: `1px solid ${COLOR.pebbleBorder}`,
    boxShadow: 'none',
    padding: '10px 14px',
    fontSize: '13px',
    iconColorInfo: COLOR.coolAccent,
    iconColorSuccess: COLOR.positive,
    iconColorWarning: COLOR.warmAccent,
    iconColorError: COLOR.error
  },

  /* === Popover: white with pebble border, blueprint text accent === */
  Popover: {
    color: COLOR.pureWhite,
    borderRadius: '6px',
    border: `1px solid ${COLOR.pebbleBorder}`,
    textColor: COLOR.inkBlack,
    titleTextColor: COLOR.inkBlack,
    titleFontWeight: '600',
    padding: '14px 18px',
    boxShadow: `0 4px 14px ${COLOR.shadowMedium}, 0 1px 3px ${COLOR.shadowLight}`,
    arrowColor: COLOR.pureWhite
  },

  /* === Tooltip: 深色 ink 黑底, 白字 ===
     折叠后菜单 hover 显示的就是 n-tooltip, 默认主题在白底白箭头
     上看着很弱, 改成深底能让标签更明确。 */
  Tooltip: {
    peers: {
      Popover: {
        color: COLOR.inkBlack,
        textColor: COLOR.pureWhite,
        borderRadius: '6px',
        padding: '6px 10px',
        fontSize: '12px',
        boxShadow: `0 4px 14px ${COLOR.shadowMedium}, 0 1px 3px ${COLOR.shadowLight}`
      }
    }
  }
}

/* ============================================================
   Dark overrides —— 继承 light, 只覆盖需要翻的面板/文字/边框
   ============================================================
   关键翻转:
   - bodyColor / cardColor / modalColor / popoverColor / tableColor / inputColor:
       warm-cream (#fafaf5) → #1a1a1a (canvas), pure-white (#fff) → #2a2a2a (cards)
   - textColor1/2/3 + iconColor: ink → graphite → mid-gray 翻成 light 系列 (#f0f0f0 / #c8c8c8 / #888)
   - borderColor / dividerColor / pebble 系列: #cecdca → #3a3a3a
   - Button/Card/Input/Select/Card/DataTable/Menu 等面板色: 翻 dark
   - 品牌色 (terracotta / blueprint / sage / red / purple) 保留
   - shadows 用更深的 rgba black alpha, 因为 dark 背景下浅阴影看不出
*/
const DARK_SURFACE = '#1a1a1a'         // warm-cream 反相
const DARK_CARD = '#2a2a2a'             // pure-white 反相
const DARK_SECTION = '#353535'          // stone-gray 反相
const DARK_SECTION_PRESSED = '#404040'  // stone-gray-pressed 反相
const DARK_INK = '#f0f0f0'              // ink-black → 文字主色
const DARK_INK_HOVER = '#d8d8d8'        // ink-black-hover
const DARK_BORDER = '#3a3a3a'           // pebble-border
const DARK_TEXT_2 = '#c8c8c8'           // graphite → secondary text
const DARK_TEXT_3 = '#888888'           // mid-gray → tertiary text
const DARK_TEXT_DISABLED = '#555555'    // text-disabled

const DARK_SHADOW = 'rgba(0, 0, 0, 0.40)'
const DARK_SHADOW_LIGHT = 'rgba(0, 0, 0, 0.20)'

export const darkOverrides: GlobalThemeOverrides = {
  ...lightOverrides,
  common: {
    ...lightOverrides.common,
    bodyColor: DARK_SURFACE,
    cardColor: DARK_CARD,
    modalColor: DARK_CARD,
    popoverColor: DARK_CARD,
    tableColor: DARK_CARD,
    inputColor: DARK_CARD,
    actionColor: DARK_SECTION,
    tableHeaderColor: DARK_SECTION,
    tagColor: DARK_SECTION,
    borderColor: DARK_BORDER,
    dividerColor: DARK_BORDER,
    textColorBase: DARK_INK,
    textColor1: DARK_INK,
    textColor2: DARK_TEXT_2,
    textColor3: DARK_TEXT_3,
    textColorDisabled: DARK_TEXT_DISABLED,
    placeholderColor: DARK_TEXT_3,
    placeholderColorDisabled: DARK_TEXT_DISABLED,
    iconColor: DARK_TEXT_2,
    iconColorHover: DARK_INK,
    iconColorPressed: DARK_INK,
    iconColorDisabled: DARK_TEXT_DISABLED,
    boxShadow1: `0 1px 2px ${DARK_SHADOW_LIGHT}`,
    boxShadow2: `0 4px 14px ${DARK_SHADOW}, 0 1px 3px ${DARK_SHADOW_LIGHT}`,
    boxShadow3: `0 8px 24px ${DARK_SHADOW}, 0 2px 6px ${DARK_SHADOW_LIGHT}`
  },
  Button: {
    ...lightOverrides.Button,
    textColor: DARK_INK,
    textColorHover: DARK_INK,
    textColorPressed: DARK_INK,
    textColorFocus: DARK_INK,
    color: DARK_CARD,
    colorHover: DARK_SECTION,
    colorPressed: DARK_SECTION_PRESSED,
    colorFocus: DARK_CARD,
    border: `1px solid ${DARK_BORDER}`,
    borderHover: `1px solid ${DARK_TEXT_3}`,
    borderPressed: `1px solid ${DARK_TEXT_2}`,
    borderFocus: `1px solid ${COLOR.coolAccent}`,
    // info / success / error variant card fills
    colorInfo: DARK_CARD,
    colorHoverInfo: 'rgba(74, 90, 122, 0.20)',
    colorSuccess: DARK_CARD,
    colorError: DARK_CARD,
    colorHoverError: 'rgba(185, 76, 76, 0.20)',
    borderError: `1px solid ${DARK_BORDER}`,
    // error 文字色保留 light (它是品牌语义色)
  },
  Card: {
    ...lightOverrides.Card,
    color: DARK_CARD,
    colorEmbedded: DARK_SURFACE,
    borderColor: DARK_BORDER,
    titleTextColor: DARK_INK,
    closeColor: DARK_TEXT_3,
    closeColorHover: DARK_INK,
    closeColorPressed: DARK_INK
  },
  Tag: {
    ...lightOverrides.Tag,
    color: DARK_SECTION,
    textColor: DARK_INK,
    border: `1px solid ${DARK_BORDER}`
  },
  Input: {
    ...lightOverrides.Input,
    border: `1px solid ${DARK_BORDER}`,
    borderHover: `1px solid ${DARK_TEXT_3}`,
    color: DARK_CARD,
    colorFocus: DARK_CARD,
    textColor: DARK_INK,
    placeholderColor: DARK_TEXT_3,
    borderDisabled: `1px solid ${DARK_SECTION}`,
    colorDisabled: DARK_SECTION,
    textColorDisabled: DARK_TEXT_DISABLED
  },
  Select: {
    peers: {
      InternalSelection: {
        ...lightOverrides.Select!.peers!.InternalSelection,
        border: `1px solid ${DARK_BORDER}`,
        borderHover: `1px solid ${DARK_TEXT_3}`,
        color: DARK_CARD,
        textColor: DARK_INK,
        placeholderColor: DARK_TEXT_3,
        colorDisabled: DARK_SECTION,
        textColorDisabled: DARK_TEXT_DISABLED
      },
      InternalSelectMenu: {
        ...lightOverrides.Select!.peers!.InternalSelectMenu,
        color: DARK_CARD,
        optionTextColor: DARK_INK,
        optionColorPending: DARK_SURFACE,
        optionColorActive: DARK_SECTION,
        optionColorActivePending: DARK_SECTION
      }
    }
  },
  DataTable: {
    ...lightOverrides.DataTable,
    borderColor: DARK_BORDER,
    thColor: DARK_SECTION,
    thColorHover: DARK_SECTION_PRESSED,
    thColorActive: DARK_SECTION_PRESSED,
    tdColor: DARK_CARD,
    tdColorHover: DARK_SECTION,
    tdColorStriped: DARK_SECTION,
    thTextColor: DARK_TEXT_3,
    tdTextColor: DARK_INK,
    borderColorModal: DARK_BORDER,
    thBorderColor: DARK_BORDER,
    tdBorderColor: DARK_BORDER
  },
  Menu: {
    ...lightOverrides.Menu,
    itemTextColor: DARK_TEXT_2,
    itemTextColorHover: DARK_INK,
    itemIconColor: DARK_TEXT_2,
    itemIconColorHover: DARK_INK,
    itemColorHover: DARK_SECTION,
    itemColorActiveHover: DARK_SECTION,
    itemColorChildActiveHover: DARK_SECTION,
    arrowColor: DARK_TEXT_3,
    arrowColorHover: DARK_INK
  },
  Layout: {
    ...lightOverrides.Layout,
    color: DARK_SURFACE,
    siderColor: DARK_CARD,
    siderBorderColor: DARK_BORDER,
    siderToggleButtonColor: DARK_CARD,
    siderToggleButtonBorderColor: DARK_BORDER,
    headerColor: DARK_SURFACE,
    headerBorderColor: DARK_BORDER,
    footerColor: DARK_SURFACE,
    footerBorderColor: DARK_BORDER,
    bodyColor: DARK_SURFACE
  },
  Modal: { color: DARK_CARD },
  Dialog: {
    ...lightOverrides.Dialog,
    color: DARK_CARD,
    border: `1px solid ${DARK_BORDER}`,
    titleTextColor: DARK_INK
  },
  Alert: {
    ...lightOverrides.Alert,
    color: DARK_CARD,
    textColor: DARK_INK
  },
  Divider: {
    ...lightOverrides.Divider,
    color: DARK_BORDER,
    textColor: DARK_TEXT_3
  },
  Switch: {
    ...lightOverrides.Switch,
    railColor: DARK_SECTION,
    buttonColor: DARK_CARD,
    boxShadow: `0 0 0 1px ${DARK_BORDER}`
  },
  Empty: {
    ...lightOverrides.Empty,
    textColor: DARK_TEXT_3,
    iconColor: DARK_BORDER
  },
  Spin: {
    ...lightOverrides.Spin,
    textColor: DARK_TEXT_2
  },
  Statistic: {
    ...lightOverrides.Statistic,
    valueTextColor: DARK_INK,
    labelTextColor: DARK_TEXT_3
  },
  Tabs: {
    ...lightOverrides.Tabs,
    tabTextColor: DARK_TEXT_2,
    tabTextColorActive: DARK_INK,
    tabTextColorHover: DARK_INK
  },
  Form: {
    ...lightOverrides.Form,
    labelTextColor: DARK_INK
  },
  Slider: {
    ...lightOverrides.Slider,
    railColor: DARK_SECTION,
    railColorHover: DARK_SECTION_PRESSED,
    railColorPressed: DARK_SECTION_PRESSED,
    handleBoxShadow: `0 0 0 1px ${DARK_BORDER}`,
    indicatorTextColor: DARK_CARD,
    indicatorColor: DARK_INK_HOVER
  },
  Collapse: {
    ...lightOverrides.Collapse,
    headerTextColor: DARK_INK,
    headerIconColor: DARK_TEXT_3,
    headerIconColorHover: DARK_INK,
    dividerColor: DARK_BORDER
  },
  Descriptions: {
    ...lightOverrides.Descriptions,
    thTextColor: DARK_TEXT_3,
    tdTextColor: DARK_INK,
    borderColor: DARK_BORDER
  },
  Skeleton: {
    ...lightOverrides.Skeleton,
    color: DARK_SECTION,
    colorEnd: '#2f2f2f'
  },
  Notification: {
    ...lightOverrides.Notification,
    color: DARK_CARD,
    border: `1px solid ${DARK_BORDER}`,
    titleTextColor: DARK_INK,
    metaTextColor: DARK_TEXT_3,
    contentTextColor: DARK_TEXT_2,
    boxShadow: `0 4px 14px ${DARK_SHADOW}, 0 1px 3px ${DARK_SHADOW_LIGHT}`
  },
  Message: {
    ...lightOverrides.Message,
    colorInfo: DARK_CARD,
    colorSuccess: DARK_CARD,
    colorWarning: DARK_CARD,
    colorError: DARK_CARD,
    border: `1px solid ${DARK_BORDER}`,
    boxShadow: `0 4px 14px ${DARK_SHADOW}, 0 1px 3px ${DARK_SHADOW_LIGHT}`
  },
  Popover: {
    ...lightOverrides.Popover,
    color: DARK_CARD,
    border: `1px solid ${DARK_BORDER}`,
    textColor: DARK_INK,
    titleTextColor: DARK_INK,
    boxShadow: `0 4px 14px ${DARK_SHADOW}, 0 1px 3px ${DARK_SHADOW_LIGHT}`,
    arrowColor: DARK_CARD
  },
  Tooltip: {
    peers: {
      // 折叠菜单 tooltip 仍然走深色 ink 黑底 + 白字, dark 模式下沿用同结构但加深 shadow
      Popover: {
        color: COLOR.inkBlack,
        textColor: COLOR.pureWhite,
        borderRadius: '6px',
        padding: '6px 10px',
        fontSize: '12px',
        boxShadow: `0 4px 14px ${DARK_SHADOW}, 0 1px 3px ${DARK_SHADOW_LIGHT}`
      }
    }
  }
}