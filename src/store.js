import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert } from './util'

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    // 某些场合自动执行 install，比如 <script> 引入
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    // 非生产环境下给出调试信息
    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    const {
      plugins = [],
      strict = false
    } = options

    // 标志一个提交状态，作用是保证对 Vuex 中 state 的修改只能在 mutation 的回调函数中，而不能在外部随意修改 state
    this._committing = false
    // 用来存储用户定义的所有的 actions
    this._actions = Object.create(null)
    this._actionSubscribers = []
    // 用来存储用户定义所有的 mutatins
    this._mutations = Object.create(null)
    // 用来存储用户定义的所有 getters
    this._wrappedGetters = Object.create(null)
    // 注册模块
    this._modules = new ModuleCollection(options)
    // 存储命名空间的模块
    this._modulesNamespaceMap = Object.create(null)
    // 用来存储所有对 mutation 变化的订阅者
    this._subscribers = []
    // 是一个 Vue 对象的实例，主要是利用 Vue 实例方法 $watch 来观测变化
    this._watcherVM = new Vue()

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    // 提交 action，并且绑定 store
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    // 提交 mutation，并且绑定 store
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // this.strict 表示是否开启严格模式，在严格模式下会观测所有的 state 的变化，建议在开发环境时开启严格模式，线上环境要关闭严格模式，否则会有一定的性能开销
    this.strict = strict

    const state = this._modules.root.state

    // init root module. 初始化根模块
    // this also recursively registers all sub-modules 并递归注册所有子模块
    // and collects all module getters inside this._wrappedGetters
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    resetStoreVM(this, state)

    // apply plugins
    plugins.forEach(plugin => plugin(this))

    if (Vue.config.devtools) {
      devtoolPlugin(this)
    }
  }

  // 访问 store.state 的时候，实际上会访问 Store 类上定义的 state 的 get 方法
  get state () {
    return this._vm._data.$$state
  }

  // 给出提示信息，不能设置 state 值
  set state (v) {
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  // 提交 mutation，子模块的 commit 已在 makeLocalContext 中拼装好前缀
  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    const entry = this._mutations[type]
    // 非生产环境下给出提示信息，不存在相应的 mutation
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })
    // 触发 commit 的订阅回调函数
    this._subscribers.forEach(sub => sub(mutation, this.state))

    // 非生产环境下给出提示信息，silent 选项已被移除
    if (
      process.env.NODE_ENV !== 'production' &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  // 提交 action，子模块的 dispatch 已在 makeLocalContext 中拼装好前缀
  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    // // 非生产环境下给出提示信息，不存在相应的 action
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    // 触发 dispatch 的订阅回调函数
    this._actionSubscribers.forEach(sub => sub(action, this.state))

    return entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)
  }

  // 订阅 store 的 mutation
  subscribe (fn) {
    return genericSubscribe(fn, this._subscribers)
  }

  // 订阅 store 的 action
  subscribeAction (fn) {
    return genericSubscribe(fn, this._actionSubscribers)
  }

  // 响应式地侦听 fn 的返回值，当值改变时调用回调函数
  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    // fn 接收 store 的 state 作为第一个参数，其 getter 作为第二个参数。要停止侦听，调用此方法返回的函数即可停止侦听
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  // 替换 store 的根状态，仅用状态合并或时光旅行调试
  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  // 模块动态注册
  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    // 非生产环境下给出 path 参数校验提示信息
    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    // 注册模块
    this._modules.register(path, rawModule)
    // 初始化模块
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...（重新实例化 store._vm，并销毁旧的 store_vm）
    resetStoreVM(this, this.state)
  }

  // 模块动态卸载（只会移除我们运行时动态创建的模块）
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    // 执行 unregister 方法去修剪我们的模块树
    this._modules.unregister(path)
    // 删除 state 在该路径下的引用
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    // 把 store 下的对应存储的 _actions、_mutations、_wrappedGetters 和 _modulesNamespaceMap 都清空，然后重新执行 installModule 安装所有模块以及 resetStoreVM 重置 store._vm
    resetStore(this)
  }

  // 热替换新的 action 和 mutation
  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    // 把 store 下的对应存储的 _actions、_mutations、_wrappedGetters 和 _modulesNamespaceMap 都清空，然后重新执行 installModule 安装所有模块以及 resetStoreVM 重置 store._vm
    resetStore(this, true)
  }

  // 内置提交修改 state，防止被捕获
  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

// 通用订阅函数
function genericSubscribe (fn, subs) {
  // 如果是新的回调函数，则添加
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  // 返回函数，调用即可停止订阅
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

// 重置 _actions、_mutations、_wrappedGetters、_modulesNamespaceMap，并重新执行 installModule、resetStoreVM
function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

// 建立 getters 和 state 的联系
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism（使用 computed 的懒加载机制）
    // 根据 key 访问 store.getters 的某一个 getter 的时候，实际上就是访问了 store._vm[key]，也就是 computed[key]
    // 在执行 computed[key] 对应的函数的时候，会执行 rawGetter(local.state,...) 方法，那么就会访问到 store.state
    // 进而访问到 store._vm_data.$$state，这样就建立了一个依赖关系。当 store.state 发生变化的时候，下一次再访问 store.getters 的时候会重新计算。
    computed[key] = () => fn(store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }

  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    // 销毁旧的 vue 实例
    Vue.nextTick(() => oldVm.$destroy())
  }
}

// 对模块中的 state、getters、mutations、actions 做初始化工作
// store 表示 root store；state 表示 root state；path 表示模块的访问路径；module 表示当前的模块；hot 表示是否是热更新
function installModule (store, rootState, path, module, hot) {
  // 判断是否是根模块
  const isRoot = !path.length
  // 获取 path 路径下的命名空间
  const namespace = store._modules.getNamespace(path)

  // register in namespace map（把 namespace 对应的模块保存下来，为了方便以后能根据 namespace 查找模块）
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // state 初始化
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state)
    })
  }

  const local = module.context = makeLocalContext(store, namespace, path)

  // 遍历模块下的 mutations，并注册
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  // 遍历模块下的 actions，并注册
  module.forEachAction((action, key) => {
    // root 为 true 时，表示在带命名空间的模块注册全局 action
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  // 遍历模块下的 getters，并注册
  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 遍历模块中的所有子 modules，递归执行 installModule 方法
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 * store 表示 root store；namespace 表示模块的命名空间，path 表示模块的 path
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  // 如果没有命名空间，则使用 root store 的 dispatch 和 commit 方法，options 为 { root: true } 时，在全局命名空间内分发 action 或提交 mutation
  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        // 把 type 自动拼接上 namespace
        type = namespace + type
        // 非生产环境下给出提示信息
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args
      
      if (!options || !options.root) {
        // 把 type 自动拼接上 namespace
        type = namespace + type
        // 非生产环境下给出提示信息
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

// 获取子模块的 getters
function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length
  // 遍历 root store 下的所有 getters
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace（判断是否匹配命名空间）
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type（只有匹配的时候从 namespace 的位置截取后面的字符串得到 localType）
    const localType = type.slice(splitPos)

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}

// 给 root store 上的 _mutations[types] 添加 wrappedMutationHandler 方法（注意，同一 type 的 _mutations 可以对应多个方法）
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}

// 给 root store 上的 _actions[types] 添加 wrappedActionHandler 方法
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

// root store 上的 _wrappedGetters[key] 指定 wrappedGetter 方法
function registerGetter (store, type, rawGetter, local) {
  // 注意，同一 type 的 _wrappedGetters 只能定义一个，非生产环境下给出提示信息
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

// 开启严格模式（在严格模式下，无论何时发生了状态变更且不是由 mutation 函数引起的，将会抛出错误，这能保证所有的状态变更都能被调试工具跟踪到）
function enableStrictMode (store) {
  // store._vm 添加一个 wathcer 来观测 this._data.$$state 的变化
  store._vm.$watch(function () { return this._data.$$state }, () => {
    // 非生产环境下，当 store.state 被修改的时候, store._committing 必须为 true，否则给出提示信息
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

// 从 root state 开始，通过 path.reduce 方法一层层查找子模块 state，最终找到目标模块的 state
function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}

// 统一对象风格 store.commit({ type: 'increment', amount: 10 }) | store.commit('increment', { amount: 10 })
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  // 非生产环境下给出提示信息
  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

export function install (_Vue) {
  // 保证反复调用只执行一次
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
