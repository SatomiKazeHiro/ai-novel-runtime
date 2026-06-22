/**
 * Naive UI themeOverrides —— light 与 dark 双套, 同一工厂 buildOverrides(palette) 生成.
 *
 * 设计原则:
 *   1) buildOverrides(palette) 是唯一工厂, 所有 GlobalThemeOverrides 字段都从 palette.p.xxx 读.
 *   2) lightOverrides = buildOverrides(LIGHT_PALETTE), darkOverrides = buildOverrides(DARK_PALETTE).
 *      加新主题 (high-contrast / sepia / ...) 只需在 tokens.ts 加一个 PALETTE,
 *      在 App.vue 加一个 mode 分支 — 不改本文件.
 *   3) 个别组件 (Tooltip) 故意不随主题翻 — 它永远是深底白字, 用 LIGHT_PALETTE 硬编码,
 *      不通过 p 参数.
 *
 * 颜色逻辑与 spec "5.1 抽 naive-theme.ts + 改 App.vue 接入层" 一致.
 */
import type { GlobalThemeOverrides } from 'naive-ui'
import { LIGHT_PALETTE, DARK_PALETTE, type Palette } from './tokens'

const COMMON_FONT_FAMILY = "'DM Sans', 'matter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Helvetica Neue', Arial, sans-serif"
const COMMON_FONT_FAMILY_MONO = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

/* ============================================================
   buildOverrides — 唯一工厂, 任何主题都走这套形状
   ============================================================ */
function buildOverrides(p: Palette): GlobalThemeOverrides {
  return {
    /* === Common: brand palette + typography + surfaces + radius === */
    common: {
      primaryColor: p.warmAccent,
      primaryColorHover: p.warmAccentHover,
      primaryColorPressed: p.warmAccentPressed,
      primaryColorSuppl: p.warmAccent,
      infoColor: p.coolAccent,
      infoColorHover: p.coolAccentHover,
      infoColorPressed: p.coolAccentPressed,
      successColor: p.positive,
      successColorHover: p.positiveHover,
      successColorPressed: p.positivePressed,
      warningColor: p.warmAccent,
      warningColorHover: p.warmAccentHover,
      warningColorPressed: p.warmAccentPressed,
      errorColor: p.error,
      errorColorHover: p.errorHover,
      errorColorPressed: p.errorPressed,

      bodyColor: p.warmCream,
      cardColor: p.pureWhite,
      modalColor: p.pureWhite,
      popoverColor: p.pureWhite,
      tableColor: p.pureWhite,
      inputColor: p.pureWhite,
      actionColor: p.stoneGray,
      tableHeaderColor: p.stoneGray,
      tagColor: p.stoneGray,

      borderColor: p.pebbleBorder,
      dividerColor: p.pebbleBorder,

      textColorBase: p.inkBlack,
      textColor1: p.inkBlack,
      textColor2: p.graphite,
      textColor3: p.midGray,
      textColorDisabled: p.textDisabled,
      placeholderColor: p.placeholder,
      placeholderColorDisabled: p.placeholderDisabled,
      iconColor: p.graphite,
      iconColorHover: p.inkBlack,
      iconColorPressed: p.inkBlack,
      iconColorDisabled: p.textDisabled,

      fontFamily: COMMON_FONT_FAMILY,
      fontFamilyMono: COMMON_FONT_FAMILY_MONO,
      fontWeight: '400',
      fontWeightStrong: '600',

      borderRadius: '6px',
      borderRadiusSmall: '6px',
      boxShadow1: `0 1px 2px ${p.shadowLight}`,
      boxShadow2: `0 4px 14px ${p.shadowMedium}, 0 1px 3px ${p.shadowLight}`,
      boxShadow3: `0 8px 24px ${p.shadowStrong}, 0 2px 6px ${p.shadowLight}`
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
      textColor: p.inkBlack,
      textColorHover: p.inkBlack,
      textColorPressed: p.inkBlack,
      textColorFocus: p.inkBlack,
      color: p.pureWhite,
      colorHover: p.stoneGray,
      colorPressed: p.stoneGrayPressed,
      colorFocus: p.pureWhite,
      border: `1px solid ${p.pebbleBorder}`,
      borderHover: `1px solid ${p.midGray}`,
      borderPressed: `1px solid ${p.graphite}`,
      borderFocus: `1px solid ${p.coolAccent}`,
      textColorPrimary: p.pureWhite,
      textColorHoverPrimary: p.pureWhite,
      textColorPressedPrimary: p.pureWhite,
      textColorFocusPrimary: p.pureWhite,
      colorPrimary: p.warmAccent,
      colorHoverPrimary: p.warmAccentHover,
      colorPressedPrimary: p.warmAccentPressed,
      colorFocusPrimary: p.warmAccentHover,
      borderPrimary: `1px solid ${p.warmAccent}`,
      borderHoverPrimary: `1px solid ${p.warmAccentHover}`,
      borderPressedPrimary: `1px solid ${p.warmAccentPressed}`,
      borderFocusPrimary: `1px solid ${p.warmAccentHover}`,
      textColorInfo: p.coolAccent,
      textColorHoverInfo: p.coolAccentHover,
      textColorPressedInfo: p.coolAccentPressed,
      colorInfo: p.pureWhite,
      colorHoverInfo: p.coolAccentTintLight,
      colorPressedInfo: p.coolAccentTintPressed,
      borderInfo: `1px solid ${p.coolAccent}`,
      borderHoverInfo: `1px solid ${p.coolAccentHover}`,
      borderPressedInfo: `1px solid ${p.coolAccentPressed}`,
      textColorSuccess: p.pureWhite,
      textColorHoverSuccess: p.pureWhite,
      textColorPressedSuccess: p.pureWhite,
      colorSuccess: p.positive,
      colorHoverSuccess: p.positiveHover,
      colorPressedSuccess: p.positivePressed,
      borderSuccess: `1px solid ${p.positive}`,
      borderHoverSuccess: `1px solid ${p.positiveHover}`,
      borderPressedSuccess: `1px solid ${p.positivePressed}`,
      textColorWarning: p.pureWhite,
      textColorHoverWarning: p.pureWhite,
      textColorPressedWarning: p.pureWhite,
      colorWarning: p.warmAccentTint,
      colorHoverWarning: p.warmAccentTintHover,
      colorPressedWarning: p.warmAccentTintPressed,
      borderWarning: `1px solid ${p.warmAccent}`,
      borderHoverWarning: `1px solid ${p.warmAccentHover}`,
      borderPressedWarning: `1px solid ${p.warmAccentPressed}`,
      textColorError: p.error,
      textColorHoverError: p.errorHover,
      textColorPressedError: p.errorPressed,
      colorError: p.pureWhite,
      colorHoverError: p.errorTintLight,
      colorPressedError: p.errorTintPressed,
      colorFocusError: p.errorTintFocus,
      borderError: `1px solid ${p.pebbleBorder}`,
      borderHoverError: `1px solid ${p.error}`,
      borderPressedError: `1px solid ${p.errorPressed}`,
      borderFocusError: `1px solid ${p.error}`,
      textColorText: p.coolAccent,
      textColorHoverText: p.coolAccentHover,
      textColorPressedText: p.coolAccentPressed,
      textColorFocusText: p.coolAccentHover,
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
      color: p.pureWhite,
      colorEmbedded: p.warmCream,
      borderColor: p.pebbleBorder,
      titleTextColor: p.inkBlack,
      titleFontWeight: '600',
      titleFontSize: '16px',
      paddingMedium: '20px 24px',
      paddingLarge: '28px 32px',
      paddingSmall: '14px 18px',
      actionPaddingMedium: '0 24px 20px 24px',
      closeColor: p.midGray,
      closeColorHover: p.inkBlack,
      closeColorPressed: p.inkBlack
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
      color: p.stoneGray,
      textColor: p.inkBlack,
      border: `1px solid ${p.pebbleBorder}`,
      colorInfo: p.infoTint,
      textColorInfo: p.coolAccent,
      borderInfo: '1px solid transparent',
      colorSuccess: p.positiveTint,
      textColorSuccess: p.positive,
      borderSuccess: '1px solid transparent',
      colorWarning: p.warmAccentTint,
      textColorWarning: p.warmAccent,
      borderWarning: '1px solid transparent',
      colorError: p.errorTint,
      textColorError: p.error,
      borderError: '1px solid transparent'
    },

    /* === Input: 1px pebble, focus = terracotta ring, white fill === */
    Input: {
      borderRadius: '6px',
      border: `1px solid ${p.pebbleBorder}`,
      borderHover: `1px solid ${p.midGray}`,
      borderFocus: `1px solid ${p.warmAccent}`,
      boxShadowFocus: `0 0 0 1px ${p.focusRing}`,
      color: p.pureWhite,
      colorFocus: p.pureWhite,
      textColor: p.inkBlack,
      placeholderColor: p.placeholder,
      caretColor: p.warmAccent,
      heightMedium: '36px',
      heightSmall: '28px',
      heightLarge: '40px',
      paddingMedium: '0 12px',
      fontSizeMedium: '14px',
      fontSizeSmall: '13px',
      borderDisabled: `1px solid ${p.stoneGray}`,
      colorDisabled: p.stoneGray,
      textColorDisabled: p.textDisabled
    },

    /* === Select: white + 1px pebble + terracotta focus; menu = white with selected = blueprint text === */
    Select: {
      peers: {
        InternalSelection: {
          borderRadius: '6px',
          border: `1px solid ${p.pebbleBorder}`,
          borderHover: `1px solid ${p.midGray}`,
          borderFocus: `1px solid ${p.warmAccent}`,
          boxShadowFocus: `0 0 0 1px ${p.focusRing}`,
          color: p.pureWhite,
          textColor: p.inkBlack,
          placeholderColor: p.placeholder,
          caretColor: p.warmAccent,
          heightMedium: '36px',
          heightSmall: '30px',
          heightLarge: '40px',
          fontSizeMedium: '14px',
          fontSizeSmall: '13px',
          colorDisabled: p.stoneGray,
          textColorDisabled: p.textDisabled
        },
        InternalSelectMenu: {
          borderRadius: '6px',
          color: p.pureWhite,
          optionTextColor: p.inkBlack,
          optionColorPending: p.warmCream,
          optionColorActive: p.warmCream,
          optionColorActivePending: p.warmCream,
          optionTextColorActive: p.coolAccent,
          optionCheckColor: p.coolAccent,
          optionHeightMedium: '34px'
        }
      }
    },

    /* === DataTable: 1px pebble separators, stone-gray th, white td === */
    DataTable: {
      borderRadius: '6px',
      borderColor: p.pebbleBorder,
      thColor: p.stoneGray,
      thColorHover: p.stoneGrayPressed,
      thColorActive: p.stoneGrayPressed,
      tdColor: p.pureWhite,
      tdColorHover: p.warmCream,
      tdColorStriped: p.warmCream,
      thTextColor: p.midGray,
      tdTextColor: p.inkBlack,
      thFontWeight: '600',
      fontSize: '14px',
      thPaddingMedium: '12px 16px',
      thPaddingSmall: '10px 12px',
      thPaddingLarge: '14px 18px',
      tdPaddingMedium: '14px 16px',
      tdPaddingSmall: '12px 12px',
      tdPaddingLarge: '16px 18px',
      borderColorModal: p.pebbleBorder,
      thBorderColor: p.pebbleBorder,
      tdBorderColor: p.pebbleBorder
    },

    /* === Menu: active = blueprint, no fill === */
    Menu: {
      borderRadius: '6px',
      color: 'transparent',
      borderColor: 'transparent',
      itemTextColor: p.graphite,
      itemTextColorHover: p.inkBlack,
      itemTextColorActive: p.coolAccent,
      itemTextColorActiveHover: p.coolAccent,
      itemTextColorActiveCollapsed: p.coolAccent,
      itemTextColorChildActive: p.coolAccent,
      itemTextColorChildActiveHover: p.coolAccent,
      itemIconColor: p.graphite,
      itemIconColorHover: p.inkBlack,
      itemIconColorActive: p.coolAccent,
      itemIconColorActiveHover: p.coolAccent,
      itemIconColorActiveCollapsed: p.coolAccent,
      itemIconColorChildActive: p.coolAccent,
      itemIconColorChildActiveHover: p.coolAccent,
      itemColorHover: p.stoneGray,
      itemColorActive: 'transparent',
      itemColorActiveHover: p.stoneGray,
      itemColorActiveCollapsed: 'transparent',
      itemColorChildActive: 'transparent',
      itemColorChildActiveHover: p.stoneGray,
      fontWeightActive: '500',
      fontWeightActiveCollapsed: '500',
      arrowColor: p.midGray,
      arrowColorHover: p.inkBlack,
      arrowColorActive: p.coolAccent,
      arrowColorActiveHover: p.coolAccent,
      arrowColorChildActive: p.coolAccent,
      arrowColorChildActiveHover: p.coolAccent
    },

    /* === Layout: cream body, white sider, 1px pebble borders === */
    Layout: {
      color: p.warmCream,
      siderColor: p.pureWhite,
      siderBorderColor: p.pebbleBorder,
      siderToggleButtonColor: p.pureWhite,
      siderToggleButtonBorderColor: p.pebbleBorder,
      headerColor: p.warmCream,
      headerBorderColor: p.pebbleBorder,
      footerColor: p.warmCream,
      footerBorderColor: p.pebbleBorder,
      bodyColor: p.warmCream
    },

    /* === Modal: white card, no shadow === */
    Modal: { color: p.pureWhite },

    /* === Dialog: 6px radius, 1px pebble border === */
    Dialog: {
      color: p.pureWhite,
      borderRadius: '6px',
      border: `1px solid ${p.pebbleBorder}`,
      titleTextColor: p.inkBlack,
      titleFontWeight: '600',
      paddingMedium: '20px 24px',
      paddingLarge: '28px 32px',
      iconColorInfo: p.coolAccent,
      iconColorSuccess: p.positive,
      iconColorWarning: p.warmAccent,
      iconColorError: p.error
    },

    /* === Alert: flat, semantic-tinted backgrounds === */
    Alert: {
      color: p.pureWhite,
      colorInfo: p.infoTint,
      colorSuccess: p.positiveTint,
      colorWarning: p.warmAccentTint,
      colorError: p.errorTint10,
      textColor: p.inkBlack,
      textColorInfo: p.coolAccent,
      textColorSuccess: p.positive,
      textColorWarning: p.warmAccent,
      textColorError: p.error,
      borderRadius: '6px',
      border: '1px solid transparent',
      borderInfo: '1px solid transparent',
      borderSuccess: '1px solid transparent',
      borderWarning: '1px solid transparent',
      borderError: '1px solid transparent',
      iconColorInfo: p.coolAccent,
      iconColorSuccess: p.positive,
      iconColorWarning: p.warmAccent,
      iconColorError: p.error,
      fontSize: '13px',
      paddingMedium: '14px 18px'
    },

    /* === Divider: pebble === */
    Divider: {
      color: p.pebbleBorder,
      textColor: p.midGray,
      fontWeight: '500'
    },

    /* === Switch: rail = terracotta when active === */
    Switch: {
      railColor: p.stoneGray,
      railColorActive: p.warmAccent,
      buttonColor: p.pureWhite,
      buttonColorActive: p.pureWhite,
      boxShadow: `0 0 0 1px ${p.pebbleBorder}`,
      boxShadowActive: `0 0 0 1px ${p.coolAccent}`,
      height: '22px',
      width: '40px',
      buttonBoxShadow: `0 2px 4px 0 ${p.shadowButton}`
    },

    /* === Empty: dim icon + tertiary description === */
    Empty: {
      textColor: p.midGray,
      iconColor: p.pebbleBorder,
      fontSize: '13px',
      padding: '32px 0'
    },

    /* === Spin: terracotta spinner === */
    Spin: {
      color: p.warmAccent,
      textColor: p.graphite,
      fontSize: '14px'
    },

    /* === Statistic: ink value, eyebrow-style label === */
    Statistic: {
      valueTextColor: p.inkBlack,
      valueFontWeight: '600',
      valueFontSizeMedium: '32px',
      valueFontSizeLarge: '40px',
      valueFontSizeHuge: '48px',
      labelTextColor: p.midGray,
      labelFontSize: '11px',
      labelFontWeight: '600'
    },

    /* === Tabs: terracotta underline bar, ink active text === */
    Tabs: {
      tabTextColor: p.graphite,
      tabTextColorActive: p.inkBlack,
      tabTextColorHover: p.inkBlack,
      tabFontWeightActive: '600',
      tabFontWeight: '400',
      barColor: p.warmAccent,
      tabGapMedium: '24px',
      tabGapSmall: '16px',
      tabGapLarge: '32px',
      tabPaddingMedium: '8px 0',
      tabPaddingSmall: '6px 0',
      tabPaddingLarge: '12px 0',
      navColor: 'transparent',
      barColorActive: 'transparent',
      barColorActivePrimary: p.warmAccent
    },

    /* === Form: medium weight label === */
    Form: {
      labelTextColor: p.inkBlack,
      labelFontSize: '14px',
      labelFontWeight: '500',
      labelHeight: '34px',
      feedbackTextColorError: p.error,
      feedbackTextColorWarning: p.warmAccent,
      feedbackTextColorInfo: p.coolAccent,
      feedbackFontSize: '12px',
      asteriskColor: p.error
    },

    /* === Slider: terracotta fill === */
    Slider: {
      fillColor: p.warmAccent,
      fillColorHover: p.warmAccentHover,
      fillColorPressed: p.warmAccentPressed,
      handleColor: p.warmAccent,
      handleColorHover: p.warmAccentHover,
      handleColorPressed: p.warmAccentPressed,
      railColor: p.stoneGray,
      railColorHover: p.stoneGrayPressed,
      railColorPressed: p.stoneGrayPressed,
      handleBoxShadow: `0 0 0 1px ${p.pebbleBorder}`,
      handleBoxShadowHover: `0 0 0 1px ${p.warmAccent}`,
      handleBoxShadowPressed: `0 0 0 1px ${p.warmAccent}`,
      handleBoxShadowFocus: `0 0 0 1px ${p.warmAccent}`,
      indicatorTextColor: p.pureWhite,
      indicatorColor: p.inkBlack,
      fontSize: '12px'
    },

    /* === Collapse: flat header, no shadow === */
    Collapse: {
      borderRadius: '6px',
      fontSize: '14px',
      headerFontSize: '14px',
      headerFontWeight: '500',
      headerTextColor: p.inkBlack,
      headerTextColorHover: p.coolAccent,
      headerTextColorActive: p.coolAccent,
      headerIconColor: p.midGray,
      headerIconColorHover: p.inkBlack,
      headerIconColorActive: p.coolAccent,
      titlePaddingMedium: '10px 14px',
      bodyPaddingMedium: '0 14px 14px 14px',
      dividerColor: p.pebbleBorder
    },

    /* === Descriptions: pebble separators, eyebrow label === */
    Descriptions: {
      thColor: 'transparent',
      thTextColor: p.midGray,
      thFontWeight: '600',
      thPaddingMedium: '12px 16px',
      thPaddingSmall: '10px 12px',
      thPaddingLarge: '14px 18px',
      tdColor: 'transparent',
      tdTextColor: p.inkBlack,
      tdPaddingMedium: '12px 16px',
      tdPaddingSmall: '10px 12px',
      tdPaddingLarge: '16px 18px',
      borderColor: p.pebbleBorder
    },

    /* === Skeleton: pebble-toned placeholder === */
    Skeleton: {
      color: p.stoneGray,
      colorEnd: p.skeletonEnd,
      colorActive: p.coolAccentTintLight,
      borderRadius: '6px'
    },

    /* === LoadingBar: terracotta progress === */
    LoadingBar: {
      colorError: p.error,
      colorInfo: p.coolAccent,
      colorLoading: p.warmAccent,
      colorSuccess: p.positive,
      colorWarning: p.warmAccent,
      height: '2px'
    },

    /* === Notification: white card, 1px pebble === */
    Notification: {
      color: p.pureWhite,
      borderRadius: '6px',
      border: `1px solid ${p.pebbleBorder}`,
      titleTextColor: p.inkBlack,
      titleFontWeight: '600',
      metaTextColor: p.midGray,
      contentTextColor: p.graphite,
      iconColorInfo: p.coolAccent,
      iconColorSuccess: p.positive,
      iconColorWarning: p.warmAccent,
      iconColorError: p.error,
      boxShadow: 'none'
    },

    /* === Message: white pill, 1px pebble === */
    Message: {
      colorInfo: p.pureWhite,
      colorSuccess: p.pureWhite,
      colorWarning: p.pureWhite,
      colorError: p.pureWhite,
      textColorInfo: p.coolAccent,
      textColorSuccess: p.positive,
      textColorWarning: p.warmAccent,
      textColorError: p.error,
      borderRadius: '6px',
      border: `1px solid ${p.pebbleBorder}`,
      boxShadow: 'none',
      padding: '10px 14px',
      fontSize: '13px',
      iconColorInfo: p.coolAccent,
      iconColorSuccess: p.positive,
      iconColorWarning: p.warmAccent,
      iconColorError: p.error
    },

    /* === Popover: white with pebble border, blueprint text accent === */
    Popover: {
      color: p.pureWhite,
      borderRadius: '6px',
      border: `1px solid ${p.pebbleBorder}`,
      textColor: p.inkBlack,
      titleTextColor: p.inkBlack,
      titleFontWeight: '600',
      padding: '14px 18px',
      boxShadow: `0 4px 14px ${p.shadowMedium}, 0 1px 3px ${p.shadowLight}`,
      arrowColor: p.pureWhite
    },

    /* === Tooltip: 故意不随主题翻 — 深底白字是 tooltip 的统一设计 === */
    Tooltip: {
      peers: {
        Popover: {
          color: LIGHT_PALETTE.inkBlack,
          textColor: LIGHT_PALETTE.pureWhite,
          borderRadius: '6px',
          padding: '6px 10px',
          fontSize: '12px',
          boxShadow: `0 4px 14px ${p.shadowMedium}, 0 1px 3px ${p.shadowLight}`
        }
      }
    }
  }
}

/* ============================================================
   Public exports —— App.vue 根据 isDark 选 light/dark overrides
   ============================================================ */
export const lightOverrides = buildOverrides(LIGHT_PALETTE)
export const darkOverrides = buildOverrides(DARK_PALETTE)