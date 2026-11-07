/**
 * BFF-proxied API client.
 *
 * All requests are sent to /api/backend/... (the BFF proxy route).
 * The proxy adds X-Backend-Base-Url and X-API-Key so this client
 * never talks to the backend directly.
 */
import { createGateway } from '@/lib/api/gateway'
import type { ApiFailure, ApiGateway, Result } from '@/lib/api/gateway'
import { unwrapLegacy } from '@/lib/api/legacyRequest'
import { getFeed } from '@/lib/api/feed'
import { getStarredArticles, starArticle, dismissArticle, unstarArticle } from '@/lib/api/articles'
import { getPodcasts, getPodcast, updatePosition, markCompleted, submitQuizAnswers } from '@/lib/api/podcasts'
import { getSources, addSource, deleteSource, getFeaturedSources, getOnboardingStatus, completeOnboarding, getPreferences, updatePreferences } from '@/lib/api/settings'
import { getGenerationQuota, getListeningStreak, getDifficultySuggestion, getLearningDashboard } from '@/lib/api/users'
import { saveVocabulary, getVocabulary, getVocabularyTestSession, submitVocabularyTestResult } from '@/lib/api/vocabulary'
import { checkHealth } from '@/lib/api/health'
import { login, logout, register, getMe, updateProfile, changePassword, deleteAccount, getPasskeyRegisterOptions, verifyPasskeyRegistration, getPasskeyLoginOptions, verifyPasskeyLogin, getPasskeyCredentials, deletePasskeyCredential, getSessions, revokeSession, revokeOtherSessions } from '@/lib/api/auth'
import { getMetrics, listUsers, createUser, updateUser, deleteUser, createInvite, listInvites, revokeInvite, listFeaturedSites, createFeaturedSite, updateFeaturedSite, deleteFeaturedSite } from '@/lib/api/admin'
import { getVapidPublicKey, subscribePush, unsubscribePush } from '@/lib/api/notifications'

export { ApiError } from '@/lib/api/legacyRequest'

// Result を返す関数を、呼出ごとに gateway を得て旧契約（失敗は throw）へ包む。
function legacy<A extends unknown[], T>(fn: (gateway: ApiGateway, ...args: A) => Promise<Result<T, ApiFailure>>) {
  return async (...args: A): Promise<T> => unwrapLegacy(await fn(createGateway(), ...args))
}

export function createApiClient() {
  return {
    getFeed: legacy(getFeed),
    getStarredArticles: legacy(getStarredArticles),
    starArticle: legacy(starArticle),
    dismissArticle: legacy(dismissArticle),
    unstarArticle: legacy(unstarArticle),
    getPodcasts: legacy(getPodcasts),
    getPodcast: legacy(getPodcast),
    updatePosition: legacy(updatePosition),
    markCompleted: legacy(markCompleted),
    submitQuizAnswers: legacy(submitQuizAnswers),
    getSources: legacy(getSources),
    addSource: legacy(addSource),
    deleteSource: legacy(deleteSource),
    getFeaturedSources: legacy(getFeaturedSources),
    getOnboardingStatus: legacy(getOnboardingStatus),
    completeOnboarding: legacy(completeOnboarding),
    getPreferences: legacy(getPreferences),
    getGenerationQuota: legacy(getGenerationQuota),
    getListeningStreak: legacy(getListeningStreak),
    getDifficultySuggestion: legacy(getDifficultySuggestion),
    getLearningDashboard: legacy(getLearningDashboard),
    saveVocabulary: legacy(saveVocabulary),
    getVocabulary: legacy(getVocabulary),
    getVocabularyTestSession: legacy(getVocabularyTestSession),
    submitVocabularyTestResult: legacy(submitVocabularyTestResult),
    updatePreferences: legacy(updatePreferences),
    checkHealth: legacy(checkHealth),
    login: legacy(login),
    logout: legacy(logout),
    register: legacy(register),
    getMe: legacy(getMe),
    updateProfile: legacy(updateProfile),
    changePassword: legacy(changePassword),
    deleteAccount: legacy(deleteAccount),
    getMetrics: legacy(getMetrics),
    listUsers: legacy(listUsers),
    createUser: legacy(createUser),
    updateUser: legacy(updateUser),
    deleteUser: legacy(deleteUser),
    createInvite: legacy(createInvite),
    listInvites: legacy(listInvites),
    revokeInvite: legacy(revokeInvite),
    listFeaturedSites: legacy(listFeaturedSites),
    createFeaturedSite: legacy(createFeaturedSite),
    updateFeaturedSite: legacy(updateFeaturedSite),
    deleteFeaturedSite: legacy(deleteFeaturedSite),
    getVapidPublicKey: legacy(getVapidPublicKey),
    subscribePush: legacy(subscribePush),
    unsubscribePush: legacy(unsubscribePush),
    getPasskeyRegisterOptions: legacy(getPasskeyRegisterOptions),
    verifyPasskeyRegistration: legacy(verifyPasskeyRegistration),
    getPasskeyLoginOptions: legacy(getPasskeyLoginOptions),
    verifyPasskeyLogin: legacy(verifyPasskeyLogin),
    getPasskeyCredentials: legacy(getPasskeyCredentials),
    deletePasskeyCredential: legacy(deletePasskeyCredential),
    getSessions: legacy(getSessions),
    revokeSession: legacy(revokeSession),
    revokeOtherSessions: legacy(revokeOtherSessions),
  }
}
