<template>
  <n-config-provider
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-loading-bar-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <n-message-provider>
            <router-view />
          </n-message-provider>
        </n-notification-provider>
      </n-dialog-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import {
  NConfigProvider,
  NLoadingBarProvider,
  NDialogProvider,
  NNotificationProvider,
  NMessageProvider,
  zhCN,
  dateZhCN,
  type GlobalThemeOverrides
} from 'naive-ui'
import { COLOR } from './styles/tokens'

/* boords.com style — warm storyboard studio on cream paper.
   Naive UI themeOverrides require literal color values (hex/rgba),
   because the seemly color parser does NOT resolve var(--color-*) refs.
   Therefore every color below comes from src/styles/tokens.ts (the JS
   twin of src/styles/tokens.css). The two files are kept in sync by hand.

   Palette:
   - Terracotta (COLOR.warmAccent) = single warm accent (CTA, marks, italic emphasis, focus)
   - Blueprint blue (COLOR.coolAccent) = single cool accent (links, nav active)
   - Sage green (COLOR.positive) = positive state (live, approved, ok)
   - Calm red (COLOR.error) = error / danger
   - Muted purple (COLOR.review) = review-only state

   Shape language:
   - 6px default radius; 1px pebble borders; no drop shadows
   - DM Sans = matter substitute; full weight range 400/500/600/700 */
const themeOverrides: GlobalThemeOverrides = {
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

    fontFamily: "'DM Sans', 'matter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Helvetica Neue', Arial, sans-serif",
    fontFamilyMono: "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
  Modal: {
    color: COLOR.pureWhite
  },

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
</script>
