package expo.modules.voicedarasr

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Kaldi-compatible 80-band log-mel filterbank for the speaker model, as WeSpeaker computes it
 * (25 ms Hamming frames every 10 ms, DC removed, pre-emphasis 0.97, no dither, 512-point power
 * spectrum, mel bins from 20 Hz to Nyquist, natural log), then the utterance mean removed.
 * A line-for-line port of the server's src/services/speaker/fbank.js: keep the two in step.
 * Both are checked against test-data/fbank-reference.json (kaldi-native-fbank).
 */
object Fbank {
  private const val SAMPLE_RATE = 16000
  private const val FRAME = 400
  private const val SHIFT = 160
  private const val FFT = 512
  private const val PREEMPHASIS = 0.97
  private const val LOW_HZ = 20.0
  private const val EPSILON = 1.1920928955078125e-7

  private fun melScale(hz: Double) = 1127.0 * ln(1.0 + hz / 700.0)

  private val window = DoubleArray(FRAME) { 0.54 - 0.46 * cos(2 * PI * it / (FRAME - 1)) }
  private val reversed = IntArray(FFT) { i ->
    var r = 0
    for (b in 0 until 9) r = (r shl 1) or ((i shr b) and 1)
    r
  }
  private val cosTable = DoubleArray(FFT / 2) { cos(-2 * PI * it / FFT) }
  private val sinTable = DoubleArray(FFT / 2) { sin(-2 * PI * it / FFT) }
  private val banks = HashMap<Int, Array<DoubleArray>>()

  private fun melBanks(numBins: Int): Array<DoubleArray> = banks.getOrPut(numBins) {
    val lowMel = melScale(LOW_HZ)
    val delta = (melScale(SAMPLE_RATE / 2.0) - lowMel) / (numBins + 1)
    Array(numBins) { b ->
      val left = lowMel + b * delta
      val center = left + delta
      val right = center + delta
      DoubleArray(FFT / 2) { k ->
        val m = melScale(SAMPLE_RATE.toDouble() / FFT * k)
        max(0.0, min((m - left) / (center - left), (right - m) / (right - center)))
      }
    }
  }

  /** frames x numBins, row-major. `samples`: 16 kHz mono in [-1, 1]. */
  fun compute(samples: FloatArray, numBins: Int = 80): Pair<FloatArray, Int> {
    val bankWeights = synchronized(banks) { melBanks(numBins) }
    val frames = if (samples.size < FRAME) 0 else 1 + (samples.size - FRAME) / SHIFT
    val feats = FloatArray(frames * numBins)
    val re = DoubleArray(FFT)
    val im = DoubleArray(FFT)
    val frame = DoubleArray(FRAME)

    for (f in 0 until frames) {
      val start = f * SHIFT
      var mean = 0.0
      for (i in 0 until FRAME) {
        frame[i] = samples[start + i] * 32768.0 // WeSpeaker reads 16-bit PCM without normalising
        mean += frame[i]
      }
      mean /= FRAME
      for (i in 0 until FRAME) frame[i] -= mean
      for (i in FRAME - 1 downTo 1) frame[i] -= PREEMPHASIS * frame[i - 1]
      frame[0] -= PREEMPHASIS * frame[0]

      re.fill(0.0)
      im.fill(0.0)
      for (i in 0 until FRAME) re[reversed[i]] = frame[i] * window[i]
      var size = 2
      while (size <= FFT) {
        val half = size / 2
        val step = FFT / size
        var i = 0
        while (i < FFT) {
          for (j in 0 until half) {
            val c = cosTable[j * step]
            val s = sinTable[j * step]
            val a = i + j
            val b = a + half
            val tr = re[b] * c - im[b] * s
            val ti = re[b] * s + im[b] * c
            re[b] = re[a] - tr
            im[b] = im[a] - ti
            re[a] += tr
            im[a] += ti
          }
          i += size
        }
        size *= 2
      }

      for (b in 0 until numBins) {
        val weights = bankWeights[b]
        var energy = 0.0
        for (k in 0 until FFT / 2) if (weights[k] != 0.0) energy += weights[k] * (re[k] * re[k] + im[k] * im[k])
        feats[f * numBins + b] = ln(max(energy, EPSILON)).toFloat()
      }
    }

    for (b in 0 until numBins) {
      var sum = 0.0
      for (f in 0 until frames) sum += feats[f * numBins + b]
      val mean = (sum / frames).toFloat()
      for (f in 0 until frames) feats[f * numBins + b] -= mean
    }
    return Pair(feats, frames)
  }
}
