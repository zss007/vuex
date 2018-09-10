import Module from './module'
import { assert, forEachValue } from '../util'

export default class ModuleCollection {
  constructor (rawRootModule) {
    // 注册根模块 (Vuex.Store options)
    this.register([], rawRootModule, false)
  }

  // 获取路径上的子模块
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  // 获取相应路径下模块的命名空间（从 root module 开始，通过 reduce 方法一层层找子模块，如果发现该模块配置了 namespaced 为 true，则把该模块的 key 拼到 namesapce 中，最终返回完整的 namespace 字符串）
  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  // 更新模块，执行 update (path, targetModule, newModule)
  update (rawRootModule) {
    // 更新根模块
    update([], this.root, rawRootModule)
  }

  // 注册模块
  register (path, rawModule, runtime = true) {
    // 非生产环境下对选项参数做检测
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime)
    if (path.length === 0) {  // 根模块
      this.root = newModule
    } else {  // 子模块
      // 调用父模块的 addChild 方法建立父子关系
      const parent = this.get(path.slice(0, -1))
      parent.addChild(path[path.length - 1], newModule)
    }

    // register nested modules（递归注册子模块，建立父子关系）
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  // 卸载模块
  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    // 只会移除我们运行时动态创建的模块
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key)
  }
}

// 更新模块具体实现
function update (path, targetModule, newModule) {
  // 非生产环境下做类型检测
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, newModule)
  }

  // update target module（更新 targetModule 的 namespaced、actions、mutations、getters）
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      // 如果 newModule 存在 targetModule 没有的子模块，则给出 reload 提示信息
      if (!targetModule.getChild(key)) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      // 递归更新子模块
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

// 函数类型判断
const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

// 函数或含 handler 函数属性的对象类型判断
const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

// 对 getters、mutations、actions 分别做类型判断
const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}

// Vuex.Store options 类型检测
function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    // 如果 options 中没有该选项则跳过
    if (!rawModule[key]) return

    // 获取类型检测对象 functionAssert | objectAssert
    const assertOptions = assertTypes[key]

    // 遍历 options 中的选项进行类型检测
    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

// 获取断言信息，用于失败时输出提示信息给开发者
function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
