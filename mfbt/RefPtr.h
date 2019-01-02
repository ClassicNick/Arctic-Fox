/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Helpers for defining and using refcounted objects. */

#ifndef mozilla_RefPtr_h
#define mozilla_RefPtr_h

#include "mozilla/AlreadyAddRefed.h"
#include "mozilla/Assertions.h"
#include "mozilla/Atomics.h"
#include "mozilla/Attributes.h"
#include "mozilla/Move.h"
#include "mozilla/RefCounted.h"
#include "mozilla/RefCountType.h"
#include "mozilla/TypeTraits.h"
#if defined(MOZILLA_INTERNAL_API)
#include "nsXPCOM.h"
#endif

#if defined(MOZILLA_INTERNAL_API) && \
    (defined(DEBUG) || defined(FORCE_BUILD_REFCNT_LOGGING))
#define MOZ_REFCOUNTED_LEAK_CHECKING
#endif

namespace mozilla {

template<typename T> class TemporaryRef;
template<typename T> class OutParamRef;
template<typename T> OutParamRef<T> byRef(RefPtr<T>&);



/**
 * RefPtr points to a refcounted thing that has AddRef and Release
 * methods to increase/decrease the refcount, respectively.  After a
 * RefPtr<T> is assigned a T*, the T* can be used through the RefPtr
 * as if it were a T*.
 *
 * A RefPtr can forget its underlying T*, which results in the T*
 * being wrapped in a temporary object until the T* is either
 * re-adopted from or released by the temporary.
 */
template<typename T>
class RefPtr
{
  // To allow them to use unref()
  friend class TemporaryRef<T>;
  friend class OutParamRef<T>;

  struct DontRef {};

public:
  RefPtr() : mPtr(0) {}
  RefPtr(const RefPtr& aOther) : mPtr(ref(aOther.mPtr)) {}
  MOZ_IMPLICIT RefPtr(const TemporaryRef<T>& aOther) : mPtr(aOther.take()) {}
  MOZ_IMPLICIT RefPtr(already_AddRefed<T>& aOther) : mPtr(aOther.take()) {}
  MOZ_IMPLICIT RefPtr(T* aVal) : mPtr(ref(aVal)) {}

  template<typename U>
  RefPtr(const RefPtr<U>& aOther) : mPtr(ref(aOther.get())) {}

  ~RefPtr() { unref(mPtr); }

  RefPtr& operator=(const RefPtr& aOther)
  {
    assign(ref(aOther.mPtr));
    return *this;
  }
  RefPtr& operator=(const TemporaryRef<T>& aOther)
  {
    assign(aOther.take());
    return *this;
  }
  RefPtr& operator=(already_AddRefed<T>& aOther)
  {
    assign(aOther.take());
    return *this;
  }
  RefPtr& operator=(T* aVal)
  {
    assign(ref(aVal));
    return *this;
  }

  template<typename U>
  RefPtr& operator=(const RefPtr<U>& aOther)
  {
    assign(ref(aOther.get()));
    return *this;
  }

  TemporaryRef<T> forget()
  {
    T* tmp = mPtr;
    mPtr = nullptr;
    return TemporaryRef<T>(tmp, DontRef());
  }

  T* get() const { return mPtr; }
  operator T*() const { return mPtr; }
  T* operator->() const MOZ_NO_ADDREF_RELEASE_ON_RETURN { return mPtr; }
  T& operator*() const { return *mPtr; }

private:
  void assign(T* aVal)
  {
    unref(mPtr);
    mPtr = aVal;
  }

  T* MOZ_OWNING_REF mPtr;

  static MOZ_ALWAYS_INLINE T* ref(T* aVal)
  {
    if (aVal) {
      aVal->AddRef();
    }
    return aVal;
  }

  static MOZ_ALWAYS_INLINE void unref(T* aVal)
  {
    if (aVal) {
      aVal->Release();
    }
  }
};

/**
 * TemporaryRef<T> represents an object that holds a temporary
 * reference to a T.  TemporaryRef objects can't be manually ref'd or
 * unref'd (being temporaries, not lvalues), so can only relinquish
 * references to other objects, or unref on destruction.
 */
template<typename T>
class TemporaryRef
{
  // To allow it to construct TemporaryRef from a bare T*
  friend class RefPtr<T>;

  typedef typename RefPtr<T>::DontRef DontRef;

public:
  // Please see already_AddRefed for a description of what these constructors
  // do.
  TemporaryRef() : mPtr(nullptr) {}
  typedef void (TemporaryRef::* MatchNullptr)(double, float);
  MOZ_IMPLICIT TemporaryRef(MatchNullptr aRawPtr) : mPtr(nullptr) {}
  explicit TemporaryRef(T* aVal) : mPtr(RefPtr<T>::ref(aVal)) {}
  TemporaryRef(const TemporaryRef& aOther) : mPtr(aOther.take()) {}

  template<typename U>
  TemporaryRef(const TemporaryRef<U>& aOther) : mPtr(aOther.take()) {}

  ~TemporaryRef() { RefPtr<T>::unref(mPtr); }

  MOZ_WARN_UNUSED_RESULT T* take() const
  {
    T* tmp = mPtr;
    mPtr = nullptr;
    return tmp;
  }

private:
  TemporaryRef(T* aVal, const DontRef&) : mPtr(aVal) {}

  mutable T* MOZ_OWNING_REF mPtr;

  void operator=(const TemporaryRef&) = delete;
};

/**
 * OutParamRef is a wrapper that tracks a refcounted pointer passed as
 * an outparam argument to a function.  OutParamRef implements COM T**
 * outparam semantics: this requires the callee to AddRef() the T*
 * returned through the T** outparam on behalf of the caller.  This
 * means the caller (through OutParamRef) must Release() the old
 * object contained in the tracked RefPtr.  It's OK if the callee
 * returns the same T* passed to it through the T** outparam, as long
 * as the callee obeys the COM discipline.
 *
 * Prefer returning TemporaryRef<T> from functions over creating T**
 * outparams and passing OutParamRef<T> to T**.  Prefer RefPtr<T>*
 * outparams over T** outparams.
 */
template<typename T>
class OutParamRef
{
  friend OutParamRef byRef<T>(RefPtr<T>&);

public:
  ~OutParamRef()
  {
    RefPtr<T>::unref(mRefPtr.mPtr);
    mRefPtr.mPtr = mTmp;
  }

  operator T**() { return &mTmp; }

private:
  explicit OutParamRef(RefPtr<T>& p) : mRefPtr(p), mTmp(p.get()) {}

  RefPtr<T>& mRefPtr;
  T* mTmp;

  OutParamRef() = delete;
  OutParamRef& operator=(const OutParamRef&) = delete;
};

/**
 * byRef cooperates with OutParamRef to implement COM outparam semantics.
 */
template<typename T>
OutParamRef<T>
byRef(RefPtr<T>& aPtr)
{
  return OutParamRef<T>(aPtr);
}

/**
 * Helper function to be able to conveniently write things like:
 *
 *   TemporaryRef<T>
 *   f(...)
 *   {
 *     return MakeAndAddRef<T>(...);
 *   }
 *
 * since explicitly constructing TemporaryRef is unsightly.  Having an
 * explicit construction of TemporaryRef from T* also inhibits a future
 * auto-conversion from TemporaryRef to already_AddRefed, since the semantics
 * of TemporaryRef(T*) differ from already_AddRefed(T*).
 */
template<typename T, typename... Args>
TemporaryRef<T>
MakeAndAddRef(Args&&... aArgs)
{
  RefPtr<T> p(new T(Forward<Args>(aArgs)...));
  return p.forget();
}

} // namespace mozilla

#endif /* mozilla_RefPtr_h */
