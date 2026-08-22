// 测试 gifski-wasm 是否正确安装
const { init, encode } = require('gifski-wasm');

async function testGifski() {
  console.log('🔍 测试 gifski-wasm 安装...');
  
  try {
    // 测试 init 函数是否存在
    if (typeof init !== 'function') {
      throw new Error('init 函数不存在');
    }
    
    // 测试 encode 函数是否存在
    if (typeof encode !== 'function') {
      throw new Error('encode 函数不存在');
    }
    
    console.log('✅ gifski-wasm 函数导出正常');
    console.log('📊 测试通过！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    process.exit(1);
  }
}

testGifski();