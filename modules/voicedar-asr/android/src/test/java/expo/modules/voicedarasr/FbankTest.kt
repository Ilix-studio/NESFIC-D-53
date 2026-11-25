package expo.modules.voicedarasr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/** Checks Fbank against client/test-data/fbank-reference.json (kaldi-native-fbank). */
class FbankTest {
  private val reference = File("../../../test-data/fbank-reference.json").readText()

  private fun number(key: String) = Regex("\"$key\":(\\d+)").find(reference)!!.groupValues[1].toInt()

  /** The synthetic signal described in the fixture's note. */
  private fun signal(count: Int): FloatArray {
    var seed = 7L
    return FloatArray(count) { n ->
      seed = (seed * 1664525L + 1013904223L) and 0xFFFFFFFFL
      val noise = seed.toDouble() / 4294967296.0 * 2 - 1
      (0.3 * sin(2 * PI * 220 * n / 16000) + 0.2 * sin(2 * PI * 1375 * n / 16000 + 0.5) + 0.05 * noise).toFloat()
    }
  }

  @Test
  fun matchesKaldi() {
    val expected = reference.substringAfter("\"feats\":").substringBeforeLast("}").replace("[", " ").replace("]", " ").split(',', ' ')
      .filter { it.isNotBlank() }.map { it.toDouble() }
    val (feats, frames) = Fbank.compute(signal(number("sampleCount")), number("melBins"))
    assertEquals(number("frames"), frames)
    assertEquals(expected.size, feats.size)
    var maxDiff = 0.0
    for (i in feats.indices) maxDiff = maxOf(maxDiff, abs(feats[i] - expected[i]))
    assertTrue("max difference $maxDiff", maxDiff < 2e-3)
  }

  @Test
  fun tooShortIsEmpty() {
    assertEquals(0, Fbank.compute(FloatArray(399)).second)
  }
}
