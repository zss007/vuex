import { forEachValue } from '../util'

// Base data struct for store's module, package with some attribute and method（store 模块的基础数据结构，含一些属性和方法）
export default class Module {
  constructor (rawModule, runtime) {
    // 表示是否是一个运行时创建的模块
    this.runtime = runtime
    // 存储所有子模块
    this._children = Object.create(null)
    // 模块的配置
    this._rawModule = rawModule
    const rawState = rawModule.state

    // 模块定义的 state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }

  // 该模块是否带有命名空间
  get namespaced () {
    return !!this._rawModule.namespaced
  }

  // 添加子模块
  addChild (key, module) {
    this._children[key] = module
  }

  // 移除子模块
  removeChild (key) {
    delete this._children[key]
  }

  // 获取相应 key 的子模块
  getChild (key) {
    return this._children[key]
  }

  // 更新当前 module 的 namespaced、actions、mutations、getters
  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  // 遍历子模块，将键值对传入 fn
  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  // 遍历当前模块 getters，将键值对传入 fn
  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  // 遍历当前模块 actions，将键值对传入 fn
  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  // 遍历当前模块 mutations，将键值对传入 fn
  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
