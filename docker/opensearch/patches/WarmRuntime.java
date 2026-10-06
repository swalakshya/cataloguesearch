import java.nio.file.Path;
import ai.djl.Device;
import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer;
import ai.djl.ndarray.NDManager;

/** Download and load exactly the CPU runtime versions used by OpenSearch 3.6. */
public class WarmRuntime {
    public static void main(String[] args) throws Exception {
        System.setProperty("PYTORCH_PRECXX11", "true");
        System.setProperty("PYTORCH_VERSION", "2.5.1");
        System.setProperty("DJL_CACHE_DIR", "/opt/opensearch-runtime");
        try (HuggingFaceTokenizer tokenizer = HuggingFaceTokenizer.newInstance(Path.of(args[0]));
             NDManager manager = NDManager.newBaseManager(Device.cpu(), "PyTorch")) {
            if (tokenizer.encode("आत्मा चेतन है।").getIds().length == 0) {
                throw new IllegalStateException("Tokenizer failed");
            }
            if (manager.create(new float[] {1, 2}).sum().getFloat() != 3) {
                throw new IllegalStateException("CPU runtime failed");
            }
        }
    }
}
