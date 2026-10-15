import type { StrokeStyle } from '../shared/types';
import type { ToolName } from './config';
import type { ConnectionState } from './connection';

/** UI 文言(日本語)をここに集約する */
export const MESSAGES = {
  appTitle: 'ホワイトボード',
  toolbarLabel: 'ツールバー',

  tools: {
    select: '選択 (V)',
    pen: 'ペン (P)',
    eraser: '消しゴム (E)',
    text: 'テキスト (T)',
    pan: 'パン (H)',
  } satisfies Record<ToolName, string>,

  strokeStyles: {
    solid: '実線',
    dashed: '破線',
    dotted: '点線',
    marker: 'マーカー',
  } satisfies Record<StrokeStyle, string>,

  colorPreset: (hex: string): string => `色 ${hex}`,
  customColor: '任意の色',
  strokeWidth: '線の太さ',
  strokeStyle: '線の種類',
  pressure: '筆圧',
  fontSize: '文字サイズ',
  fontSizeOption: (size: number): string => `${size}px`,
  undo: '元に戻す (Ctrl/⌘+Z)',
  redo: 'やり直し (Ctrl/⌘+Shift+Z)',
  deleteSelected: '選択中を削除 (Delete)',
  clearAll: '全消去',
  confirmClearAll: 'ボードの内容をすべて消去します。よろしいですか?',
  exportPng: 'PNG ダウンロード',
  share: '共有',
  textEditor: 'テキスト入力',

  connection: {
    connecting: '接続中…',
    connected: '接続済み',
    reconnecting: '再接続中…',
  } satisfies Record<ConnectionState, string>,
  participants: (count: number): string => `参加者 ${count} 人`,

  bannerConnecting: '接続中…(接続するまで編集できません)',
  bannerReconnecting: '再接続中…(接続が戻るまで編集できません)',

  boardEmpty: 'ボードが空です',
  exportFailed: 'PNG の書き出しに失敗しました',
  urlCopied: 'URL をコピーしました',
  copyFailed: 'URL を自動でコピーできませんでした。この URL をコピーして共有してください',
  shareTitle: 'ホワイトボード',
  errorRoomFull: 'ボードのオブジェクト数が上限に達したため、追加できませんでした',
  errorGeneric: 'サーバーでエラーが発生しました',

  invalidRoomTitle: 'ルーム ID が不正です',
  invalidRoomBody:
    'URL の room パラメータには半角英数字・ハイフン・アンダースコアのみ(1〜64 文字)を使えます。',
} as const;
