package expo.modules.voicedarasr

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.exp

class TranscribeOptions : Record {
  @Field var sampleRate: Int = 16000
  @Field var tokenOffset: Int = 0
  @Field var langVocabSize: Int = 256
  @Field var blankId: Int = 0
  @Field var minSeconds: Double = 4.0
  @Field var maxSeconds: Double = 12.0
}

/**
 * On-device speech-to-text with an IndicConformer CTC model (int8 ONNX, audio front end inside
 * the graph): decode the clip -> cut it at pauses into pieces of at most maxSeconds -> ONNX
 * Runtime -> greedy CTC over the model language's tokens. Returns token ids per piece; the app
 * turns them into text (src/asr/ctc.ts). Chunking and decoding mirror the server's
 * src/services/asr/ctc.js: keep the two in step.
 */
class VoicedarAsrModule : Module() {
  private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }
  // One model in memory at a time (about 200 MB); officers record in one language per case.
  private var session: OrtSession? = null
  private var sessionPath: String? = null

  private fun sessionFor(path: String): OrtSession = synchronized(this) {
    if (sessionPath != path) {
      session?.close()
      session = null
      val options = OrtSession.SessionOptions().apply {
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      }
      session = env.createSession(path, options)
      sessionPath = path
    }
    session!!
  }

  override fun definition() = ModuleDefinition {
    Name("VoicedarAsr")

    AsyncFunction("transcribe") Coroutine { modelUri: String, audioUri: String, options: TranscribeOptions ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.Default) {
        val started = System.currentTimeMillis()
        val modelPath = Uri.parse(modelUri).path ?: modelUri
        val samples = AudioDecoder.decode(context, audioUri, options.sampleRate)
        val session = sessionFor(modelPath)
        val pieces = mutableListOf<Map<String, Any>>()
        for ((start, end) in planChunks(samples, options.sampleRate, options.minSeconds, options.maxSeconds)) {
          // Under 0.3 s there is nothing to recognise (and the encoder needs a few frames).
          if (end - start < options.sampleRate * 0.3) continue
          pieces.add(runPiece(session, samples, start, end, options))
        }
        mapOf(
          "pieces" to pieces,
          "audioMs" to samples.size * 1000L / options.sampleRate,
          "elapsedMs" to System.currentTimeMillis() - started,
        )
      }
    }

    Function("release") {
      synchronized(this@VoicedarAsrModule) {
        session?.close()
        session = null
        sessionPath = null
      }
    }

    OnDestroy {
      session?.close()
    }
  }

  private fun runPiece(session: OrtSession, samples: FloatArray, start: Int, end: Int, o: TranscribeOptions): Map<String, Any> {
    val length = end - start
    val audio = OnnxTensor.createTensor(env, FloatBuffer.wrap(samples, start, length).slice(), longArrayOf(1, length.toLong()))
    val audioLength = OnnxTensor.createTensor(env, LongBuffer.wrap(longArrayOf(length.toLong())), longArrayOf(1))
    return audio.use {
      audioLength.use {
        session.run(mapOf("audio_signal" to audio, "audio_length" to audioLength)).use { result ->
          val logProbs = result.get("log_probs").get() as OnnxTensor
          val encoded = result.get("encoded_length").get() as OnnxTensor
          val shape = logProbs.info.shape // [1, frames, vocab]
          val frames = minOf(shape[1].toInt(), encoded.longBuffer.get(0).toInt())
          greedyCtc(logProbs.floatBuffer, frames, shape[2].toInt(), o)
        }
      }
    }
  }

  /** Greedy CTC over [tokenOffset, tokenOffset + langVocabSize) and the blank. */
  private fun greedyCtc(lp: FloatBuffer, frames: Int, vocab: Int, o: TranscribeOptions): Map<String, Any> {
    val ids = mutableListOf<Int>()
    var prev = -1
    var probSum = 0.0
    for (t in 0 until frames) {
      val row = t * vocab
      var best = o.blankId
      var bestLp = lp.get(row + o.blankId)
      for (k in o.tokenOffset until o.tokenOffset + o.langVocabSize) {
        val v = lp.get(row + k)
        if (v > bestLp) {
          bestLp = v
          best = k
        }
      }
      if (best != o.blankId && best != prev) {
        ids.add(best)
        probSum += exp(bestLp.toDouble())
      }
      prev = best
    }
    return mapOf("ids" to ids, "confidence" to if (ids.isEmpty()) 0.0 else probSum / ids.size)
  }

  /** Cuts at the quietest 100 ms between minSeconds and maxSeconds; [start, end) ranges. */
  private fun planChunks(samples: FloatArray, rate: Int, minSeconds: Double, maxSeconds: Double): List<Pair<Int, Int>> {
    val total = samples.size
    val max = Math.round(maxSeconds * rate).toInt()
    val min = Math.round(minSeconds * rate).toInt()
    val step = Math.round(rate / 10.0).toInt()
    val chunks = mutableListOf<Pair<Int, Int>>()
    var start = 0
    while (total - start > max) {
      var cut = start + max
      var quietest = Double.MAX_VALUE
      var at = start + min
      while (at + step <= start + max) {
        var energy = 0.0
        for (i in at until at + step) energy += samples[i] * samples[i]
        if (energy < quietest) {
          quietest = energy
          cut = at + Math.round(step / 2.0).toInt()
        }
        at += step
      }
      chunks.add(start to cut)
      start = cut
    }
    if (total > start) chunks.add(start to total)
    return chunks
  }
}
