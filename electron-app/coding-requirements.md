

## 支持 实时转写
- models loading
    - once loading, never reload until released manualy OR defined action
    - can selected: 1pass, punc, vad, 2pass
- 全自动实时转写：
    - start asr
    - looping: 1pass -> punc ->vad -> 2pass
    - stop asr
- 手动（热键）转写
    - hot-key press
    - looping: 1pass -> punc
    - hot-key release
    - 2pass & paste to focused edit-control
