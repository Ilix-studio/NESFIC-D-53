package expo.modules.voicedarasr

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder

/**
 * Decodes a recording (the app's 16 kHz mono AAC .m4a, or anything Android can play) to mono
 * float PCM in [-1, 1] at the requested sample rate, with Android's own codecs.
 */
object AudioDecoder {
  private const val TIMEOUT_US = 10_000L

  fun decode(context: Context, uri: String, targetRate: Int): FloatArray {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, Uri.parse(uri), null)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw IllegalArgumentException("The clip has no audio track")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      try {
        codec.configure(format, null, null, 0)
        codec.start()
        val (pcm, rate) = drain(extractor, codec, format)
        return resample(pcm, rate, targetRate)
      } finally {
        codec.release()
      }
    } finally {
      extractor.release()
    }
  }

  private fun drain(extractor: MediaExtractor, codec: MediaCodec, input: MediaFormat): Pair<FloatArray, Int> {
    var rate = input.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var channels = input.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    var floatPcm = false
    val out = FloatGrowable()
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    while (true) {
      if (!inputDone) {
        val index = codec.dequeueInputBuffer(TIMEOUT_US)
        if (index >= 0) {
          val size = extractor.readSampleData(codec.getInputBuffer(index)!!, 0)
          if (size < 0) {
            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
            extractor.advance()
          }
        }
      }
      val index = codec.dequeueOutputBuffer(info, TIMEOUT_US)
      if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        val f = codec.outputFormat
        rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        floatPcm = f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
          f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
      } else if (index >= 0) {
        val buf = codec.getOutputBuffer(index)!!.order(ByteOrder.nativeOrder())
        buf.position(info.offset)
        buf.limit(info.offset + info.size)
        // Down-mix to mono by averaging the channels.
        if (floatPcm) {
          val f = buf.asFloatBuffer()
          while (f.remaining() >= channels) {
            var sum = 0f
            repeat(channels) { sum += f.get() }
            out.add(sum / channels)
          }
        } else {
          val s = buf.asShortBuffer()
          while (s.remaining() >= channels) {
            var sum = 0f
            repeat(channels) { sum += s.get() }
            out.add(sum / channels / 32768f)
          }
        }
        codec.releaseOutputBuffer(index, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
      }
    }
    return out.toArray() to rate
  }

  /** Linear-interpolation resampler, with a box low-pass first when downsampling. */
  private fun resample(input: FloatArray, from: Int, to: Int): FloatArray {
    if (from == to || input.isEmpty()) return input
    var source = input
    if (from > to) {
      val width = Math.round(from.toFloat() / to).coerceAtLeast(1)
      if (width > 1) {
        source = FloatArray(input.size)
        var sum = 0f
        for (i in input.indices) {
          sum += input[i]
          if (i >= width) sum -= input[i - width]
          source[i] = sum / minOf(i + 1, width)
        }
      }
    }
    val length = (source.size.toLong() * to / from).toInt()
    val out = FloatArray(length)
    val step = from.toDouble() / to
    for (i in 0 until length) {
      val pos = i * step
      val j = pos.toInt()
      val frac = (pos - j).toFloat()
      val a = source[minOf(j, source.size - 1)]
      val b = source[minOf(j + 1, source.size - 1)]
      out[i] = a + (b - a) * frac
    }
    return out
  }

  private class FloatGrowable {
    private var data = FloatArray(16000 * 30)
    private var size = 0
    fun add(v: Float) {
      if (size == data.size) data = data.copyOf(data.size * 2)
      data[size++] = v
    }
    fun toArray(): FloatArray = data.copyOf(size)
  }
}
