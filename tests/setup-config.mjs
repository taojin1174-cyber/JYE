// 测试专用：把 config 重置为本机模式，避免填了云端密钥后测试整体切到云端。
// 由 package.json 的 test 脚本通过 node --import 预加载，先于所有测试文件执行。
// 需要云端模式的测试（如 cloud-import.test.mjs）自己在 import store 之前重新填入地址与公钥。
import { config } from '../config.js';
config.supabaseUrl = '';
config.supabaseKey = '';
