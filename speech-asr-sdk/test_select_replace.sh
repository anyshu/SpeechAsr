#!/bin/bash
# 测试 Shift+Left 选中并替换功能
# 用法: 在文本编辑器中输入一些文字，将光标放在文字末尾，然后运行此脚本

SELECT_LENGTH=${1:-5}  # 默认选中5个字符
PASTE_TEXT=${2:-替换内容}

echo "将选中 $SELECT_LENGTH 个字符并替换为: $PASTE_TEXT"
echo "请在5秒内切换到文本编辑器..."

sleep 5

# 先复制要粘贴的文本
echo "$PASTE_TEXT" | pbcopy

# 使用 AppleScript 发送按键
osascript <<EOF
tell application "System Events"
  -- 按 Shift+Left 选中指定数量的字符
  repeat $SELECT_LENGTH times
    keystroke (ASCII character 28) using {shift down}
  end repeat

  delay 0.2

  -- 删除选中的内容
  keystroke (ASCII character 127)

  delay 0.1

  -- 粘贴新内容
  keystroke "v" using {command down}
end tell
EOF

echo "完成!"
