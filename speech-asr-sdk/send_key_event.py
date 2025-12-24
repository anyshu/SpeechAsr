#!/usr/bin/env python3
"""
使用 AppleScript 发送键盘事件到 macOS
用于模拟 Shift+Left 选中文本，然后删除并粘贴
"""

import sys
import subprocess
import argparse


def select_and_replace_applescript(select_length, paste_text):
    """使用 AppleScript 发送键盘事件"""
    max_shifts = min(select_length, 100)

    # 先将文本复制到剪贴板
    process = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
    process.communicate(paste_text.encode('utf-8'))

    import time
    time.sleep(0.1)

    # AppleScript: 按 Shift+Left 选中，删除，然后粘贴
    apple_script = f'''
    tell application "System Events"
      -- 按 Shift+Left 选中 1pass 增量内容
      repeat {max_shifts} times
        keystroke (ASCII character 28) using {{shift down}}
      end repeat

      delay 0.1

      -- 删除选中的内容
      keystroke (ASCII character 127)

      delay 0.05

      -- 粘贴 2pass 内容
      keystroke "v" using {{command down}}
    end tell
    '''

    result = subprocess.run(['osascript', '-e', apple_script],
                          capture_output=True,
                          text=True)

    if result.returncode != 0:
        print(f"AppleScript error: {result.stderr}", file=sys.stderr)
        return False

    return True


def main():
    parser = argparse.ArgumentParser(description='Send keyboard events to select and replace text')
    parser.add_argument('select_length', type=int, help='Number of characters to select to the left')
    parser.add_argument('paste_text', type=str, help='Text to paste after selection')

    args = parser.parse_args()

    if select_and_replace_applescript(args.select_length, args.paste_text):
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == '__main__':
    main()
