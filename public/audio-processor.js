// AudioWorklet 处理器 - 用于捕获原始 PCM 音频数据
class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input && input.length > 0) {
      const channelData = input[0]; // 获取第一个声道

      if (channelData && channelData.length > 0) {
        // 转换为 16-bit PCM
        const pcmData = new Int16Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          // 将 -1.0 到 1.0 的浮点数转换为 -32768 到 32767 的整数
          const s = Math.max(-1, Math.min(1, channelData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // 发送 PCM 数据到主线程
        this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
      }
    }

    return true; // 保持处理器活跃
  }
}

registerProcessor('audio-processor', AudioProcessor);
