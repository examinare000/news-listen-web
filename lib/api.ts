/**
 * BFF-proxied API client.
 *
 * All requests are sent to /api/backend/... (the BFF proxy route).
 * The proxy adds X-Backend-Base-Url and X-API-Key so this client
 * never talks to the backend directly.
 */
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

export function createApiClient() {
  return {
    getFeed,
    getStarredArticles,
    starArticle,
    dismissArticle,
    unstarArticle,
    getPodcasts,
    getPodcast,
    updatePosition,
    markCompleted,
    submitQuizAnswers,
    getSources,
    addSource,
    deleteSource,
    getFeaturedSources,
    getOnboardingStatus,
    completeOnboarding,
    getPreferences,
    getGenerationQuota,
    getListeningStreak,
    getDifficultySuggestion,
    getLearningDashboard,
    saveVocabulary,
    getVocabulary,
    getVocabularyTestSession,
    submitVocabularyTestResult,
    updatePreferences,
    checkHealth,
    login,
    logout,
    register,
    getMe,
    updateProfile,
    changePassword,
    deleteAccount,
    getMetrics,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    createInvite,
    listInvites,
    revokeInvite,
    listFeaturedSites,
    createFeaturedSite,
    updateFeaturedSite,
    deleteFeaturedSite,
    getVapidPublicKey,
    subscribePush,
    unsubscribePush,
    getPasskeyRegisterOptions,
    verifyPasskeyRegistration,
    getPasskeyLoginOptions,
    verifyPasskeyLogin,
    getPasskeyCredentials,
    deletePasskeyCredential,
    getSessions,
    revokeSession,
    revokeOtherSessions,
  }
}
